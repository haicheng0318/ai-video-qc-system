import 'reflect-metadata';
import './env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnvironment } from './env';
import { configureOutboundProxy } from './outbound-proxy';
import { LocalizedHttpExceptionFilter } from './common/localized-http-exception.filter';

async function bootstrap() {
  validateEnvironment();

  if (configureOutboundProxy()) {
    console.log('Outbound HTTP proxy enabled.');
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new LocalizedHttpExceptionFilter());

  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  const host = process.env.API_HOST || '127.0.0.1';
  await app.listen(port, host);
}

bootstrap();
