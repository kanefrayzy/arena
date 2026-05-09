import { registerSW } from 'virtual:pwa-register';
import { toast } from '../ui/toast';

let started = false;

export function startSW(): void {
  if (started) return;
  started = true;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast.push({
        variant: 'info',
        title: 'Доступно обновление',
        message: 'Новая версия Arena1v1 готова к установке.',
        durationMs: 0,
        action: {
          label: 'Обновить',
          onClick: () => {
            void updateSW(true);
          },
        },
      });
    },
    onOfflineReady() {
      // silent
    },
    onRegisterError(err: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[sw] register failed', err);
    },
  });
}
