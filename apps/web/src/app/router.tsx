import { Navigate, Route, Routes } from 'react-router-dom';
import { SplashPage } from '../pages/splash/SplashPage';
import { LoginPage } from '../pages/login/LoginPage';
import { RegisterPage } from '../pages/register/RegisterPage';
import { HomePage } from '../pages/home/HomePage';
import { QueuePage } from '../pages/queue/QueuePage';
import { MatchPage } from '../pages/match/MatchPage';
import { ResultPage } from '../pages/result/ResultPage';
import { WalletPage } from '../pages/wallet/WalletPage';
import { LoadoutPage } from '../pages/loadout/LoadoutPage';
import { ShopPage } from '../pages/shop/ShopPage';
import { AdminPage } from '../pages/admin/AdminPage';

export function AppRouter() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <div className="relative h-full w-full overflow-hidden bg-bg shadow-2xl sm:h-[100dvh] sm:max-h-[100dvh] sm:w-auto sm:max-w-full" style={{ aspectRatio: '9 / 16' }}>
        <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/loadout" element={<LoadoutPage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/match/:id" element={<MatchPage />} />
          <Route path="/result/:id" element={<ResultPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
