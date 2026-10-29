import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import LazyPrompt from "./LazyPrompt.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("LazyPrompt", LazyPrompt);
  },
} satisfies Theme;
