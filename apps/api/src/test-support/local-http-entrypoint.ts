import { configureLocalAcceptance } from './local-acceptance';

// Import before AuthModule/any environment-reading application module. JWT
// signing configuration is captured during module evaluation, not app.listen.
configureLocalAcceptance(process.env.HTTP_ACCEPTANCE_DATABASE_URL);
