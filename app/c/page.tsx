"use client";

import ModulePageShell from "../components/module-page-shell";
import { HomeScreen } from "./components/home-screen";

export default function Home() {
  return (
    <ModulePageShell activeModule="home" pageClass="home-page">
      {() => <HomeScreen />}
    </ModulePageShell>
  );
}
