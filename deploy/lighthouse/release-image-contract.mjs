// Pure release preflight checks, exercised by the local rehearsal before start.
// No Docker/network/filesystem operations occur when importing this module.
const imageId = /^sha256:[a-f0-9]{64}$/;
const immutableReference = /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64})$/;

export function assertComposeImageContract(config, candidate) {
  if (!immutableReference.test(candidate?.apiImage ?? '') || !immutableReference.test(candidate?.webImage ?? '')
    || candidate.apiImage === candidate.webImage) throw Error('Separate registered immutable API/Web references are required; mutable tags are forbidden.');
  for (const name of ['api', 'worker', 'migrate', 'bootstrap', 'web']) {
    const service = config?.services?.[name];
    const expected = name === 'web' ? candidate.webImage : candidate.apiImage;
    if (service?.image !== expected || service.build !== undefined || service.pull_policy !== 'never') {
      throw Error(`Release image mismatch or implicit build/pull for ${name}.`);
    }
  }
}

export function startVerifiedReleaseService(phase, expectedApiId, migration, api, start) {
  if (!['api', 'worker'].includes(phase) || !imageId.test(expectedApiId ?? '')) throw Error('A valid release phase and resolved API image ID are required.');
  if (migration?.Image !== expectedApiId || migration.State?.Status !== 'exited'
    || migration.State.ExitCode !== 0 || migration.State.OOMKilled === true) {
    throw Error('API/worker start refused: successful migration from the registered API image is required.');
  }
  if (phase === 'worker' && (api?.Image !== expectedApiId || api.State?.Running !== true)) {
    throw Error('Worker start refused: the running API must use the registered API image.');
  }
  return start();
}
