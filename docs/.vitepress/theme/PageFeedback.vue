<script setup lang="ts">
// "Was this page helpful?" under every docs page: opens a pre-filled GitHub issue for this page.
import { computed, ref } from "vue";
import { useData } from "vitepress";

const { page, frontmatter } = useData();
const answer = ref<"yes" | "no" | null>(null);

const issueUrl = computed(() => {
  const url = `https://quyvh20.github.io/BOUNCER/${page.value.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "")}`;
  const title = `[docs] ${answer.value === "yes" ? "👍" : "👎"} ${page.value.title}`;
  const body = `Page: ${url}\n\nWhat was ${answer.value === "yes" ? "helpful" : "missing or unclear"}?\n\n`;
  return `https://github.com/quyvh20/BOUNCER/issues/new?labels=docs,feedback&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
});
</script>

<template>
  <div v-if="frontmatter.layout !== 'home'" class="page-feedback">
    <template v-if="!answer">
      <span>Was this page helpful?</span>
      <button type="button" @click="answer = 'yes'">👍 Yes</button>
      <button type="button" @click="answer = 'no'">👎 No</button>
    </template>
    <template v-else>
      <span>Thanks! {{ answer === "yes" ? "Want to say what helped?" : "What was missing or unclear?" }}</span>
      <a :href="issueUrl" target="_blank" rel="noopener">Tell us on GitHub →</a>
      <a href="/BOUNCER/feedback">Other feedback</a>
    </template>
  </div>
</template>
