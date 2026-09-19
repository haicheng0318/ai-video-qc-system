const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function upsertModelConfig(input) {
  await prisma.aiModelConfig.upsert({
    where: {
      agentType_provider_modelName: {
        agentType: input.agentType,
        provider: input.provider,
        modelName: input.modelName,
      },
    },
    update: {
      enabled: input.enabled,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      jsonSchema: input.jsonSchema,
    },
    create: input,
  });
}

async function main() {
  const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  const name = process.env.DEFAULT_ADMIN_NAME || '系统管理员';

  if (!password) {
    throw new Error('DEFAULT_ADMIN_PASSWORD is required for database seed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { account: username },
    // Production containers run this idempotent seed during startup. Never
    // overwrite an administrator's changed password or account settings.
    update: {},
    create: {
      name,
      account: username,
      passwordHash,
      role: UserRole.admin,
      status: 'active',
    },
  });

  await prisma.aiModelConfig.deleteMany({
    where: {
      agentType: 'video_content_review',
      enabled: false,
      jsonSchema: {
        path: ['phase'],
        equals: 'reserved',
      },
    },
  });

  await prisma.aiModelConfig.updateMany({
    where: {
      agentType: { in: ['content_review', 'video_content_review'] },
      provider: 'gemini',
      enabled: true,
    },
    data: { enabled: false },
  });

  await upsertModelConfig({
    agentType: 'video_content_review',
    provider: 'aliyun_bailian',
    modelName: 'qwen3.5-omni-plus',
    enabled: true,
    temperature: 0.2,
    jsonSchema: {
      version: 'phase-2-content-review-v2-qwen-omni',
      output: 'structured_json',
    },
  });

  await prisma.aiModelConfig.deleteMany({
    where: {
      agentType: 'result_data_review',
      provider: 'openai_gpt',
      modelName: 'reserved-gpt-result-review-model',
      enabled: false,
    },
  });

  await prisma.aiModelConfig.updateMany({
    where: {
      agentType: { in: ['result_review', 'final_evaluation'] },
      provider: { in: ['openai', 'openai_gpt'] },
      enabled: true,
    },
    data: { enabled: false },
  });

  await upsertModelConfig({
    agentType: 'result_review',
    provider: 'aliyun_bailian',
    modelName: 'qwen3.5-plus',
    enabled: true,
    temperature: 0.2,
    maxTokens: 4000,
    jsonSchema: {
      version: 'result-review-v2-qwen',
      output: 'structured_json',
    },
  });

  await prisma.aiModelConfig.deleteMany({
    where: {
      agentType: 'final_evaluation',
      provider: 'openai_gpt',
      modelName: 'reserved-gpt-final-evaluation-model',
      enabled: false,
    },
  });

  await upsertModelConfig({
    agentType: 'final_evaluation',
    provider: 'aliyun_bailian',
    modelName: 'qwen3.5-plus',
    enabled: true,
    temperature: 0.2,
    maxTokens: 4000,
    jsonSchema: {
      version: 'final-evaluation-v2-qwen',
      output: 'structured_json',
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
