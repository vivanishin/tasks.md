/* @refresh reload */
import { render } from "solid-js/web";
import { lazy } from "solid-js";
import { Router } from "@solidjs/router";
import { I18nProvider } from "./i18n";

const App = import.meta.env.VITE_OSL_READ_ONLY === "true"
  ? lazy(() => import("./components/osl-board"))
  : lazy(() => import("./App"));

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
	throw new Error(
		"Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got mispelled?",
	);
}

render(() => <I18nProvider>{import.meta.env.VITE_OSL_READ_ONLY === "true"
  ? <App /> : <Router root={App} />}</I18nProvider>, root);
