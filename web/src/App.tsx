import { CapstonePage, CapstonesPage } from "./pages/Capstone.tsx";
import { GraphPage, IntegrationPage } from "./pages/Graph.tsx";
import { ArchitecturePage, ArchitecturesPage } from "./pages/Architecture.tsx";
import { CertificatePage, CohortPage, CohortsPage, PortfolioPage, ReviewPage, ReviewsPage } from "./pages/Coursework.tsx";
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
import { PlaygroundPage } from "./pages/Playground.tsx";
import { ProjectPage } from "./pages/Project.tsx";
import { QuizPage } from "./pages/Quiz.tsx";
import { SearchPage } from "./pages/Search.tsx";
import { SimulationPage } from "./pages/Simulation.tsx";
import { TrackPage } from "./pages/Track.tsx";
import { TracksPage } from "./pages/Tracks.tsx";
import { AdminPage } from "./pages/Admin.tsx";
import { ContentEditorPage } from "./pages/ContentEditor.tsx";

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
  if ((m = matchPath("/tracks/:slug/quiz", pathname))) return <QuizPage key={m.slug} trackSlug={m.slug ?? ""} />;
  if (pathname === "/tracks/postman/playground") return <PlaygroundPage />;
  if ((m = matchPath("/tracks/:slug/projects/:id", pathname))) return <ProjectPage key={m.id} trackSlug={m.slug ?? ""} projectId={m.id ?? ""} />;
  if (pathname === "/paths") return <PathsPage />;
  if (pathname === "/capstones") return <CapstonesPage />;
  if (pathname === "/graph") return <GraphPage />;
  if (pathname === "/architecture") return <ArchitecturesPage />;
  if ((m = matchPath("/architecture/:id", pathname))) return <ArchitecturePage key={m.id} id={m.id ?? ""} />;
  if ((m = matchPath("/integrations/:id", pathname))) return <IntegrationPage key={m.id} id={m.id ?? ""} />;
  if ((m = matchPath("/capstones/:id", pathname))) return <CapstonePage key={m.id} id={m.id ?? ""} />;
  if ((m = matchPath("/paths/:slug", pathname))) return <PathPage key={m.slug} slug={m.slug ?? ""} />;
  if (pathname === "/search") return <SearchPage />;
  if (pathname === "/login") return <LoginPage />;
  if (pathname === "/register") return <RegisterPage />;
  if (pathname === "/dashboard") return <DashboardPage />;
  if (pathname === "/cohorts") return <CohortsPage />;
  if ((m = matchPath("/cohorts/:id", pathname))) return <CohortPage key={m.id} id={m.id ?? ""} />;
  if (pathname === "/reviews") return <ReviewsPage />;
  if ((m = matchPath("/reviews/:type/:id", pathname))) return <ReviewPage key={`${m.type}:${m.id}`} type={m.type ?? ""} id={m.id ?? ""} />;
  if ((m = matchPath("/portfolio/:slug", pathname))) return <PortfolioPage key={m.slug} slug={m.slug ?? ""} />;
  if ((m = matchPath("/certificates/:id", pathname))) return <CertificatePage key={m.id} id={m.id ?? ""} />;
  // Institutional screens (admin, content editor).
  if (pathname === "/admin") return <AdminPage />;
  if (pathname === "/content-editor") return <ContentEditorPage />;
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
