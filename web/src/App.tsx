import { Component, useEffect, useRef, type ReactNode } from "react";
import { Layout } from "./components/Layout.tsx";
import { NotFoundState } from "./components/States.tsx";
import { AuthProvider } from "./lib/auth.tsx";
import { matchPath, useLocation } from "./lib/router.tsx";
import { useTitle } from "./lib/useApi.ts";
import { LoginPage, RegisterPage } from "./pages/Auth.tsx";
import { DashboardPage } from "./pages/Dashboard.tsx";
import { HomePage } from "./pages/Home.tsx";
import { LabPage } from "./pages/Lab.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { PathPage, PathsPage } from "./pages/Paths.tsx";
import { SearchPage } from "./pages/Search.tsx";
import { SimulationPage } from "./pages/Simulation.tsx";
import { TrackPage } from "./pages/Track.tsx";
import { TracksPage } from "./pages/Tracks.tsx";

function NotFoundPage() {
  useTitle("Page not found");
  return (
    <div className="page">
      <NotFoundState />
    </div>
  );
}

function Routes({ pathname }: { pathname: string }) {
  let m: Record<string, string> | null;
  if (pathname === "/") return <HomePage />;
  if (pathname === "/tracks") return <TracksPage />;
  if ((m = matchPath("/tracks/:slug", pathname))) return <TrackPage key={m.slug} slug={m.slug ?? ""} />;
  if ((m = matchPath("/tracks/:slug/lessons/:id", pathname))) return <LessonPage key={m.id} trackSlug={m.slug ?? ""} lessonId={m.id ?? ""} />;
  if ((m = matchPath("/tracks/:slug/labs/:id", pathname))) return <LabPage key={m.id} trackSlug={m.slug ?? ""} labId={m.id ?? ""} />;
  if ((m = matchPath("/tracks/:slug/simulations/:id", pathname))) return <SimulationPage key={m.id} trackSlug={m.slug ?? ""} id={m.id ?? ""} />;
  if (pathname === "/paths") return <PathsPage />;
  if ((m = matchPath("/paths/:slug", pathname))) return <PathPage key={m.slug} slug={m.slug ?? ""} />;
  if (pathname === "/search") return <SearchPage />;
  if (pathname === "/login") return <LoginPage />;
  if (pathname === "/register") return <RegisterPage />;
  if (pathname === "/dashboard") return <DashboardPage />;
  return <NotFoundPage />;
}

/** On client-side navigation: scroll to the top (or the #hash) and move focus to <main> for screen readers. */
function useNavigationFocus(pathname: string, hash: string): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (hash) window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 300);
      return;
    }
    if (hash) {
      window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 50);
    } else {
      window.scrollTo(0, 0);
    }
    document.getElementById("main")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="page">
          <div className="state" role="alert">
            <h2>This page hit an unexpected error</h2>
            <p>Reload the page. If it keeps happening, report it with the page address.</p>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const { pathname, hash } = useLocation();
  useNavigationFocus(pathname, hash);
  return (
    <AuthProvider>
      <Layout>
        <ErrorBoundary resetKey={pathname}>
          <Routes pathname={pathname} />
        </ErrorBoundary>
      </Layout>
    </AuthProvider>
  );
}
