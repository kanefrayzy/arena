import { describe, expect, it } from 'vitest';
import { registerSchema } from '@arena/shared';

describe('auth schemas', () => {
  it('rejects registration without acceptTos', () => {
    const r = registerSchema.safeParse({
      email: 'a@b.com',
      username: 'alice',
      password: 'verystrong1',
      acceptAge: true,
      acceptSkillGame: true,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a fully valid registration', () => {
    const r = registerSchema.safeParse({
      email: 'a@b.com',
      username: 'alice',
      password: 'verystrong1',
      acceptTos: true,
      acceptAge: true,
      acceptSkillGame: true,
    });
    expect(r.success).toBe(true);
  });
});
