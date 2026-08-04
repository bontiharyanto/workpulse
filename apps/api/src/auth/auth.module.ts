import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConsentModule } from '../consent/consent.module';
import { NotificationModule } from '../notification/notification.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaController } from './mfa/mfa.controller';
import { MfaService } from './mfa/mfa.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
      }),
    }),
    NotificationModule,
    ConsentModule,
  ],
  controllers: [AuthController, MfaController, SessionController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    PasswordResetService,
    MfaService,
    SessionService,
    JwtStrategy,
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenService,
    MfaService,
    SessionService,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}
