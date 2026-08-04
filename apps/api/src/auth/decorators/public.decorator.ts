import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'workpulse:isPublic';

/** Marks a route (or controller) as accessible without a JWT. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
