export interface SettingMeta {
  label: string;
  description: string;
  type: 'boolean' | 'number' | 'string' | 'array' | 'object';
  example?: string;
  group: 'gameplay' | 'rooms' | 'wallet' | 'legal' | 'other';
}

export const SETTING_META: Record<string, SettingMeta> = {
  'gameplay.bot_in_free': {
    label: 'Боты в FREE-комнатах',
    description: 'Заполнять FREE-комнаты ботом, если не нашлось живого соперника за время поиска.',
    type: 'boolean',
    example: 'true',
    group: 'gameplay',
  },
  'gameplay.tickRate': {
    label: 'Tick rate сервера',
    description: 'Частота симуляции игрового мира (тиков в секунду). Выше — точнее, но дороже по CPU.',
    type: 'number',
    example: '30',
    group: 'gameplay',
  },
  'tickrate': {
    label: 'Tick rate (legacy)',
    description: 'Устаревший ключ tick rate. Используйте gameplay.tickRate.',
    type: 'number',
    example: '30',
    group: 'gameplay',
  },
  'rooms.casualEnabled': {
    label: 'CASUAL-комнаты включены',
    description: 'Разрешить игрокам играть бесплатные ранкед-матчи (без ставки, но с MMR).',
    type: 'boolean',
    example: 'true',
    group: 'rooms',
  },
  'wallet.auto_withdrawal': {
    label: 'Авто-вывод средств',
    description: 'Если true — заявки на вывод подтверждаются автоматически без участия админа. Опасно — оставляйте false для ручного контроля KYC.',
    type: 'boolean',
    example: 'false',
    group: 'wallet',
  },
  'legal.minAge': {
    label: 'Минимальный возраст',
    description: 'Минимальный возраст игрока (лет). При регистрации требуется подтверждение. Юрисдикция: для skill-game обычно 18+.',
    type: 'number',
    example: '18',
    group: 'legal',
  },
  'legal.kycRequiredFromUsd': {
    label: 'Порог KYC ($)',
    description: 'Сумма депозита/вывода в USD, начиная с которой требуется KYC-верификация личности игрока.',
    type: 'number',
    example: '1000',
    group: 'legal',
  },
  'legal.blockedCountries': {
    label: 'Заблокированные страны',
    description: 'Список ISO-кодов стран (например ["RU","US"]), из которых запрещён вход на платформу. Пустой массив — разрешены все.',
    type: 'array',
    example: '["RU","US","CN"]',
    group: 'legal',
  },
};

export const GROUP_LABELS: Record<SettingMeta['group'], string> = {
  gameplay: 'Gameplay',
  rooms: 'Rooms / matchmaking',
  wallet: 'Wallet & payouts',
  legal: 'Legal & compliance',
  other: 'Other',
};

export function getMeta(key: string): SettingMeta {
  return (
    SETTING_META[key] ?? {
      label: key,
      description: 'Custom setting (no description registered).',
      type: 'object',
      group: 'other',
    }
  );
}
