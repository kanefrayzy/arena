"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const shared_1 = require("@arena/shared");
(0, vitest_1.describe)('auth schemas', () => {
    (0, vitest_1.it)('rejects registration without acceptTos', () => {
        const r = shared_1.registerSchema.safeParse({
            email: 'a@b.com',
            username: 'alice',
            password: 'verystrong1',
            acceptAge: true,
            acceptSkillGame: true,
        });
        (0, vitest_1.expect)(r.success).toBe(false);
    });
    (0, vitest_1.it)('accepts a fully valid registration', () => {
        const r = shared_1.registerSchema.safeParse({
            email: 'a@b.com',
            username: 'alice',
            password: 'verystrong1',
            acceptTos: true,
            acceptAge: true,
            acceptSkillGame: true,
        });
        (0, vitest_1.expect)(r.success).toBe(true);
    });
});
//# sourceMappingURL=auth.schema.test.js.map