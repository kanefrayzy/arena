export interface SettingMeta {
  label: string;
  description: string;
  type: 'boolean' | 'number' | 'string' | 'array' | 'object';
  example?: string;
  group: 'gameplay' | 'rooms' | 'wallet' | 'legal' | 'bots' | 'seo' | 'other';
}

export const SETTING_META: Record<string, SettingMeta> = {
  'gameplay.bot_in_free': {
    label: 'Боты в FREE-комнатах (legacy)',
    description: 'Legacy-флаг. Используйте bots.enabled — он объединяет все комнаты.',
    type: 'boolean',
    example: 'true',
    group: 'bots',
  },
  'gameplay.tickRate': {
    label: 'Tick rate сервера',
    description: 'Частота симуляции (тиков/с). 30 — стандарт.',
    type: 'number',
    example: '30',
    group: 'gameplay',
  },
  'rooms.casualEnabled': {
    label: 'CASUAL: бесплатный вход в очередь',
    description: 'Игроки с нулевым балансом могут вставать в CASUAL-очередь. Матч всегда платный: победитель забирает пул, проигравший теряет только то, что было на балансе (до ставки). Если выключено — CASUAL работает как STAKE: нужен баланс ≥ ставки.',
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

  // ───── Cup ranking ─────
  'gameplay.cup_win': {
    label: 'Кубков за победу',
    description: 'Сколько кубков получает победитель матча.',
    type: 'number',
    example: '25',
    group: 'gameplay',
  },
  'gameplay.cup_loss': {
    label: 'Кубков за поражение',
    description: 'Сколько кубков теряет проигравший. Минимум 0 (не уходит в минус).',
    type: 'number',
    example: '15',
    group: 'gameplay',
  },

  // ───── Bots ─────
  'bots.enabled': {
    label: 'Боты включены',
    description: 'Глобальный выключатель ботов в матчмейкинге для всех комнат (FREE / CASUAL / STAKE).',
    type: 'boolean',
    example: 'true',
    group: 'bots',
  },
  'bots.difficulty': {
    label: 'Сложность ботов',
    description: 'Уровень сложности: easy | medium | hard. Влияет на реакцию, точность, использование способностей.',
    type: 'string',
    example: 'medium',
    group: 'bots',
  },
  'bots.queue_min_wait_s': {
    label: 'Мин. ожидание перед ботом, сек',
    description: 'Минимум секунд в поиске, после которого может подключиться бот.',
    type: 'number',
    example: '30',
    group: 'bots',
  },
  'bots.queue_max_wait_s': {
    label: 'Макс. ожидание перед ботом, сек',
    description: 'Верхняя граница случайного окна. Каждому пользователю выбирается случайное значение в [min, max].',
    type: 'number',
    example: '40',
    group: 'bots',
  },

  // ───── SEO ─────
  'seo.site_name': {
    label: 'Название сайта',
    description: 'Используется в og:site_name и apple-mobile-web-app-title.',
    type: 'string',
    example: 'Arena1v1',
    group: 'seo',
  },
  'seo.title': {
    label: 'Title (заголовок вкладки)',
    description: 'Тег <title> и og:title. До 60 символов рекомендуется.',
    type: 'string',
    example: 'Arena1v1 — Skill PvP 1 на 1',
    group: 'seo',
  },
  'seo.description': {
    label: 'Description',
    description: 'meta description + og:description. До 160 символов рекомендуется.',
    type: 'string',
    example: 'Браузерная Skill PvP 1 на 1 на реальные деньги.',
    group: 'seo',
  },
  'seo.keywords': {
    label: 'Keywords',
    description: 'meta keywords. Запятыми.',
    type: 'string',
    example: 'arena, pvp, 1v1, skill, browser game',
    group: 'seo',
  },
  'seo.og_image_url': {
    label: 'OG image URL',
    description: 'Полный URL картинки 1200×630 для соцсетей. Если пусто — берётся branding.og_image.',
    type: 'string',
    example: 'https://faoor.com/og.png',
    group: 'seo',
  },
  'seo.twitter_handle': {
    label: 'Twitter @handle (deprecated)',
    description: 'Устарело: оставлено для совместимости. Используйте instagram_url и telegram_url.',
    type: 'string',
    example: '@faoor',
    group: 'seo',
  },
  'seo.instagram_url': {
    label: 'Instagram URL',
    description: 'Полная ссылка на профиль Instagram. Используется в <link rel="me"> и в JSON-LD sameAs.',
    type: 'string',
    example: 'https://instagram.com/faoor',
    group: 'seo',
  },
  'seo.telegram_url': {
    label: 'Telegram URL',
    description: 'Полная ссылка на канал/чат Telegram. Используется в <link rel="me"> и в JSON-LD sameAs.',
    type: 'string',
    example: 'https://t.me/faoor',
    group: 'seo',
  },
  'seo.canonical_url': {
    label: 'Canonical / base URL',
    description: 'Базовый URL сайта (без слэша на конце). Используется в sitemap.xml и canonical link.',
    type: 'string',
    example: 'https://faoor.com',
    group: 'seo',
  },
  'seo.theme_color': {
    label: 'Theme color',
    description: 'Цвет PWA / адресной строки на мобильных. HEX.',
    type: 'string',
    example: '#1a1450',
    group: 'seo',
  },
};

export const GROUP_LABELS: Record<SettingMeta['group'], string> = {
  gameplay: 'Геймплей',
  rooms: 'Комнаты / матчмейкинг',
  wallet: 'Кошелёк и выплаты',
  legal: 'Юридическое и compliance',
  bots: 'Боты',
  seo: 'SEO и мета-теги',
  other: 'Прочее',
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
