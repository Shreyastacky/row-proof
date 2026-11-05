import { describe, expect, it } from 'vitest';
import { assertLocalTarget, parseStatusJson, StackError } from '../src/stack.js';
import { syntheticEmail } from '../src/provision.js';

describe('mutation tooling refuses remote or unexpected targets', () => {
  it('accepts the loopback origin the rule approved', () => {
    expect(() => assertLocalTarget('http://127.0.0.1:54321', 'http://127.0.0.1:54321')).not.toThrow();
    expect(() => assertLocalTarget('http://127.0.0.1:54321/', 'http://127.0.0.1:54321')).not.toThrow();
  });

  it.each([
    ['remote host', 'https://abcd.supabase.co', 'https://abcd.supabase.co'],
    ['private network address', 'http://10.0.0.5:54321', 'http://10.0.0.5:54321'],
    ['different port from the rule', 'http://127.0.0.1:55321', 'http://127.0.0.1:54321'],
    ['localhost alias vs approved 127.0.0.1', 'http://localhost:54321', 'http://127.0.0.1:54321'],
    ['credentials in URL', 'http://user:pw@127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['path in URL', 'http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1:54321'],
  ])('refuses %s', (_label, stack, approved) => {
    expect(() => assertLocalTarget(stack, approved)).toThrow(StackError);
  });
});

describe('stack status parsing', () => {
  it('reads the fields it needs and tolerates a leading warning line', () => {
    const s = parseStatusJson(
      'WARNING: something\n{"API_URL":"http://127.0.0.1:54321","PUBLISHABLE_KEY":"sb_publishable_x","SECRET_KEY":"sb_secret_y","ANON_KEY":"a.b.c"}',
    );
    expect(s.apiUrl).toBe('http://127.0.0.1:54321');
    expect(s.legacyAnonKey).toBe('a.b.c');
    expect(s.legacyServiceRoleKey).toBeNull();
  });

  it('fails clearly when the stack is not running or fields are missing', () => {
    expect(() => parseStatusJson('not running')).toThrow(StackError);
    expect(() => parseStatusJson('{"API_URL":"http://127.0.0.1:54321"}')).toThrow(StackError);
  });

  it('error messages never include key material', () => {
    try {
      parseStatusJson('{"API_URL":"http://127.0.0.1:54321","PUBLISHABLE_KEY":"sb_publishable_leak"}');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('sb_publishable_leak');
    }
  });

  it('uses reserved synthetic email addresses', () => {
    expect(syntheticEmail('invoice-owner-read', 'user-a')).toBe('user-a.invoice-owner-read@synthetic.rowproof.test');
  });
});
