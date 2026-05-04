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
    description: 'Ставить бота, если не нашлось живого соперника за время поиска.',
    type: 'boolean',
    example: 'true',
    group: 'gameplay',
  },
  'gameplay.tickRate': {
    label: 'Tick rate сервера',
    description: 'Частота симуляции (тиков/с). 30 — стандарт.',
    type: 'number',
    example: '30',
    group: 'gameplay',
  },
  'rooms.casualEnabled': {
    label: 'CASUAL: бесплатный ранкед',
    description: 'Игроки с балансом 0 могут играть CASUAL-матчи (без ставки, но с MMR).',
    type: 'boolean',
    example: 'true',
    group: 'rooms',
  },
  'wallet.auto_withdrawal': {
    label: 'Авто-вывод',
    description: '⚠️ ОПАСНО — заявки на вывод автоматически подтверждаются без KYC.',
    type: 'boolean',
    example: 'false',
    group: 'wallet',
  },
  'wallet.min_withdrawal_usd': {
    label: 'Минимум вывода ($)',
    description: 'Минимальная сумма для создания заявки на вывод (в USD).',
    type: 'number',
    example: '1',
    group: 'wallet',
  },
  'wallet.commission_pct': {
    label: 'Комиссия платформы (%)',
    description: 'Процент от суммы матча, удерживаемый платформой при победе.',
    type: 'number',
    example: '5',
    group: 'wallet',
  },
  'legal.minAge': {
    label: 'Минимальный возраст',
    description: 'Минимальный возраст при регистрации (лет).',
    type: 'number',
    example: '18',
    group: 'legal',
  },
  'legal.kycRequiredFromUsd': {
    label: 'Порог KYC ($)',
    description: 'Сумма (USD), начиная с которой требуется KYC.',
    type: 'number',
    example: '1000',
    group: 'legal',
  },
  'legal.blockedCountries': {
    label: 'Заблокированные страны',
    description: 'ISO-коды стран через запятую (например RU,US,CN). Пустой массив — разрешены все.',
    type: 'array',
    example: '["RU","US"]',
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
