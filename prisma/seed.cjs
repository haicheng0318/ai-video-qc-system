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
    update: {},
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
    update: {
      name,
      passwordHash,
      role: UserRole.admin,
      status: 'active',
    },
    create: {
      name,
      account: username,
      passwordHash,
      role: UserRole.admin,
      status: 'active',
    },
  });

  await upsertModelConfig({
    agentType: 'video_content_review',
    provider: 'gemini',
    modelName: 'reserved-gemini-video-model',
    enabled: false,
    temperature: 0.2,
    jsonSchema: {
      phase: 'reserved',
      note: 'Gemini content review schema will be added in phase 2.',
    },
  });

  await upsertModelConfig({
    agentType: 'result_data_review',
    provider: 'openai_gpt',
    modelName: 'reserved-gpt-result-review-model',
    enabled: false,
    temperature: 0.2,
    jsonSchema: {
      phase: 'reserved',
      note: 'GPT result review schema will be added in phase 5.',
    },
  });

  await upsertModelConfig({
    agentType: 'final_evaluation',
    provider: 'openai_gpt',
    modelName: 'reserved-gpt-final-evaluation-model',
    enabled: false,
    temperature: 0.2,
    jsonSchema: {
      phase: 'reserved',
      note: 'GPT final evaluation schema will be added in phase 7.',
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
