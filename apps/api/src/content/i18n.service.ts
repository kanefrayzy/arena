import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

export interface LangMeta {
  code: string;
  name: string;
  flag?: string;
}

interface RegistryFile {
  languages: LangMeta[];
}

const ROOT = join(process.cwd(), 'apps', 'api', 'uploads', 'locales');
const REGISTRY_FILE = join(ROOT, 'registry.json');

/**
 * File-based locale store. Admin-managed languages live as
 *   apps/api/uploads/locales/<code>.json    (the resource bundle)
 *   apps/api/uploads/locales/registry.json  (metadata: name, flag)
 *
 * Web client fetches GET /i18n/locales on init and merges resources.
 */
@Injectable()
export class I18nService {
  private readonly log = new Logger('I18n');

  private ensureRoot(): void {
    if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  }

  private readRegistry(): RegistryFile {
    this.ensureRoot();
    if (!existsSync(REGISTRY_FILE)) return { languages: [] };
    try {
      const txt = readFileSync(REGISTRY_FILE, 'utf8');
      const data = JSON.parse(txt) as RegistryFile;
      if (!Array.isArray(data.languages)) return { languages: [] };
      return data;
    } catch (e) {
      this.log.warn(`registry parse failed: ${(e as Error).message}`);
      return { languages: [] };
    }
  }

  private writeRegistry(reg: RegistryFile): void {
    this.ensureRoot();
    writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf8');
  }

  /** Public: list all admin-added languages and their resources. */
  list(): { languages: LangMeta[]; resources: Record<string, Record<string, string>> } {
    const reg = this.readRegistry();
    const resources: Record<string, Record<string, string>> = {};
    for (const lang of reg.languages) {
      const file = join(ROOT, `${lang.code}.json`);
      if (!existsSync(file)) continue;
      try {
        resources[lang.code] = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        /* skip corrupt */
      }
    }
    return { languages: reg.languages, resources };
  }

  /** Admin: list languages with stats (key counts, file sizes). */
  listAdmin(): { code: string; name: string; flag?: string; keys: number; bytes: number }[] {
    const reg = this.readRegistry();
    return reg.languages.map((l) => {
      const file = join(ROOT, `${l.code}.json`);
      let keys = 0;
      let bytes = 0;
      if (existsSync(file)) {
        try {
          const dict = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
          keys = Object.keys(dict).length;
          bytes = statSync(file).size;
        } catch { /* */ }
      }
      return { code: l.code, name: l.name, flag: l.flag, keys, bytes };
    });
  }

  /**
   * Add a new language. Scaffolds a resource file populated with all keys
   * from the English bundle (values pre-filled with the English text so
   * fallback works until a translator overrides them).
   */
  addLanguage(input: { code: string; name: string; flag?: string }): LangMeta {
    const code = input.code.trim().toLowerCase();
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(code)) {
      throw new BadRequestException({ code: 'INVALID_LOCALE_CODE', detail: 'use ISO format like "fr" or "pt-br"' });
    }
    if (code === 'ru' || code === 'en') {
      throw new BadRequestException({ code: 'BUNDLED_LOCALE', detail: 'ru/en are bundled with the client' });
    }
    const name = input.name.trim();
    if (!name) throw new BadRequestException({ code: 'NAME_REQUIRED' });

    const reg = this.readRegistry();
    if (reg.languages.find((l) => l.code === code)) {
      throw new BadRequestException({ code: 'ALREADY_EXISTS' });
    }

    // Scaffold from the English bundle shipped with the web app.
    let scaffold: Record<string, string> = {};
    try {
      const enFile = join(process.cwd(), 'apps', 'web', 'src', 'shared', 'i18n', 'locales', 'en.json');
      if (existsSync(enFile)) {
        scaffold = JSON.parse(readFileSync(enFile, 'utf8'));
      }
    } catch { /* fallback empty */ }

    this.ensureRoot();
    writeFileSync(join(ROOT, `${code}.json`), JSON.stringify(scaffold, null, 2), 'utf8');

    const meta: LangMeta = { code, name, flag: input.flag?.trim() || undefined };
    reg.languages.push(meta);
    this.writeRegistry(reg);
    this.log.log(`added language ${code} (${name})`);
    return meta;
  }

  /**
   * Admin: replace an existing language's resource bundle.
   *
   * Accepts both flat (`{ "a.b": "v" }`) and nested (`{ "a": { "b": "v" } }`)
   * JSON shapes — translators frequently produce the nested form, so we
   * flatten on the way in. Primitive non-string leaves (number/bool) are
   * coerced to string; arrays and null are dropped.
   */
  updateResources(code: string, dict: Record<string, unknown>): void {
    const reg = this.readRegistry();
    const found = reg.languages.find((l) => l.code === code);
    if (!found) throw new BadRequestException({ code: 'NOT_FOUND' });
    if (typeof dict !== 'object' || !dict) throw new BadRequestException({ code: 'INVALID_PAYLOAD' });

    const clean: Record<string, string> = {};
    const walk = (prefix: string, value: unknown): void => {
      if (value == null) return;
      if (typeof value === 'string') {
        clean[prefix] = value;
        return;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        clean[prefix] = String(value);
        return;
      }
      if (Array.isArray(value)) return; // i18next does not support array leaves here
      if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(prefix ? `${prefix}.${k}` : k, v);
        }
      }
    };
    for (const [k, v] of Object.entries(dict)) walk(k, v);

    if (Object.keys(clean).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_PAYLOAD',
        detail: 'no usable string keys found — check JSON shape',
      });
    }

    writeFileSync(join(ROOT, `${code}.json`), JSON.stringify(clean, null, 2), 'utf8');
    this.log.log(`updated language ${code}: ${Object.keys(clean).length} keys`);
  }

  getResources(code: string): Record<string, string> {
    const file = join(ROOT, `${code}.json`);
    if (!existsSync(file)) throw new BadRequestException({ code: 'NOT_FOUND' });
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  removeLanguage(code: string): void {
    const reg = this.readRegistry();
    const idx = reg.languages.findIndex((l) => l.code === code);
    if (idx < 0) throw new BadRequestException({ code: 'NOT_FOUND' });
    reg.languages.splice(idx, 1);
    this.writeRegistry(reg);
    // Note: we leave the json file in place so accidental deletes can be undone manually.
  }
}
