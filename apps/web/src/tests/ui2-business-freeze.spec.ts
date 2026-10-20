import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(__dirname, '../../../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = [
  'apps/web/app/videos/page.tsx', 'apps/web/app/videos/[id]/page.tsx',
  'apps/web/app/videos/new/page.tsx', 'apps/web/app/dashboard/page.tsx',
  'apps/web/app/settings/benchmarks/page.tsx', 'apps/web/src/components/app-shell.tsx',
  'apps/web/src/components/login-form.tsx', 'apps/web/src/components/case-library-page.tsx',
  'apps/web/src/components/v11-benchmark-panel.tsx', 'apps/web/src/components/v11-evaluation-panel.tsx',
  'apps/web/src/components/admin/operations-console.tsx',
  'apps/web/src/components/admin/runtime-panels.tsx', 'apps/web/src/components/admin/user-create-form.tsx',
];
const parse = (path: string, source: string) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
const print = (node: ts.Node, source: ts.SourceFile) => printer.printNode(ts.EmitHint.Unspecified, node, source);
function nodes(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(source); return found;
}
const callName = (node: ts.Node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : '';
const hasJsx = (node: ts.Node) => nodes(node, n => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)).length > 0;
function requireOriginals(before: string[], after: string[], context: string) {
  const remaining = [...after];
  for (const original of before) {
    const index = remaining.indexOf(original);
    assert.notEqual(index, -1, `${context}: removed or changed original AST node:\n${original}`);
    remaining.splice(index, 1);
  }
}

test('UI2 base is the approved production baseline', () => {
  assert.equal(git('rev-parse', 'origin/main'), '410a0327ed6c2aae0a816266fdeff5cfcf42e457');
});

test('backend, shared contracts, Prisma and critical web libraries are byte-identical to origin/main', () => {
  const changed = git('diff', '--name-only', 'origin/main', '--', 'apps/api', 'packages', 'prisma', 'apps/web/src/lib', 'package.json', 'package-lock.json');
  assert.equal(changed, '', `Frozen paths changed:\n${changed}`);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'packages', 'prisma', 'apps/web/src/lib');
  assert.equal(untracked, '', `New files in frozen paths:\n${untracked}`);
});

for (const file of files) {
  test(`${file}: API calls, effect/callback bodies and business handlers preserve the baseline AST`, () => {
    const before = parse(file, git('show', `origin/main:${file}`));
    const after = parse(file, readFileSync(resolve(root, file), 'utf8'));
    const calls = (source: ts.SourceFile, name: string) => nodes(source, node => callName(node) === name).map(node => print(node, source));
    assert.deepEqual(calls(after, 'apiFetch'), calls(before, 'apiFetch'), 'API call expressions/order changed');
    for (const hook of ['useEffect', 'useCallback']) {
      const oldHooks = calls(before, hook), newHooks = calls(after, hook);
      requireOriginals(oldHooks, newHooks, hook);
      const runtimeHooks = (source: ts.SourceFile) => nodes(source, node => callName(node) === hook && nodes(node, child => callName(child) === 'apiFetch').length > 0).map(node => print(node, source));
      assert.deepEqual(runtimeHooks(after), runtimeHooks(before), `${hook}: request trigger/dependencies changed`);
    }
    const functions = (source: ts.SourceFile) => nodes(source, node => ts.isFunctionDeclaration(node) && Boolean(node.name) && !hasJsx(node)) as ts.FunctionDeclaration[];
    for (const original of functions(before)) {
      const name = original.name!.text;
      const candidates = functions(after).filter(node => node.name!.text === name);
      assert.ok(candidates.length, `Missing original business/helper function: ${name}`);
      const normalized = candidates.map(node => {
        // Only this new setter records manual visual mode selection; persistence stays frozen.
        if (file.endsWith('/videos/page.tsx') && name === 'changeView' && node.body) {
          const statements = node.body.statements.filter(statement => !(ts.isExpressionStatement(statement) && callName(statement.expression) === 'setManualView'));
          return print(ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, ts.factory.updateBlock(node.body, statements)), after);
        }
        return print(node, after);
      });
      assert.ok(normalized.includes(print(original, before)), `Business/helper function changed: ${name}`);
    }
    const handlers = (source: ts.SourceFile) => nodes(source, node => ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(source)) && Boolean(node.initializer) && nodes(node, child => {
      const name = callName(child);
      return ['apiFetch', 'action', 'submit', 'onSubmit', 'load', 'logout', 'choose', 'openJob', 'changeHistory', 'markDirty', 'setFilters', 'setForm', 'setRates', 'setNotice'].includes(name);
    }).length > 0).map(node => print(node, source));
    // Grouped navigation repeats choose(); require every original handler, not an equal count.
    requireOriginals(handlers(before), handlers(after), 'existing business event handler');
  });
}

test('five business tabs retain all original panel props and hidden mounted regions', () => {
  const file = 'apps/web/app/videos/[id]/page.tsx';
  const before = parse(file, git('show', `origin/main:${file}`));
  const after = parse(file, readFileSync(resolve(root, file), 'utf8'));
  const declaration = nodes(after, node => ts.isVariableDeclaration(node) && node.name.getText(after) === 'detailTabs')[0] as ts.VariableDeclaration;
  assert.ok(declaration && declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer));
  assert.deepEqual(declaration.initializer.elements.map(element => (element as ts.ArrayLiteralExpression).elements.map(value => (value as ts.StringLiteral).text)), [
    ['content', '评估结果'], ['metrics', '数据表现'], ['final', '综合决策'], ['versions', '版本记录'], ['logs', '操作记录'],
  ]);
  for (const name of ['VideoPlayer', 'V11EvaluationPanel', 'SupervisorReviewPanel', 'VideoRevisionPanel', 'VideoVersionChain', 'ResultMetricsPanel', 'ResultReviewPanel', 'RuleEnginePanel', 'FinalEvaluationPanel', 'FinalConfirmationPanel']) {
    const openings = (source: ts.SourceFile) => nodes(source, node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === name).map(node => print(node, source));
    assert.deepEqual(openings(after), openings(before), `${name}: props/handlers changed`);
  }
  const expected: Record<string, string> = { content: 'content', supervisor: 'content', versions: 'versions', metrics: 'metrics', result: 'metrics', final: 'final', confirmation: 'final', logs: 'logs' };
  for (const [region, tab] of Object.entries(expected)) {
    const opening = nodes(after, node => ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(after) === 'id' && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === `detail-panel-${region}`))[0] as ts.JsxOpeningElement;
    assert.ok(opening, `Missing mounted region ${region}`);
    const hidden = opening.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(after) === 'hidden');
    assert.ok(hidden); assert.match(print(hidden, after), new RegExp(`activeTab !== '${tab}'`));
    assert.ok(ts.isJsxElement(opening.parent), 'Region must be a persistent JSX element');
    assert.ok(!ts.isConditionalExpression(opening.parent.parent) && !ts.isBinaryExpression(opening.parent.parent), `${region}: conditional mount introduced`);
  }
});
