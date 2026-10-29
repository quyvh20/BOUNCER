import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import LazyPrompt from "./LazyPrompt.vue";
import PageFeedback from "./PageFeedback.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  // "Was this page helpful?" under every docs page.
  Layout: () => h(DefaultTheme.Layout, null, { "doc-after": () => h(PageFeedback) }),
  enhanceApp({ app }) {
    app.component("LazyPrompt", LazyPrompt);
  },
} satisfies Theme;
