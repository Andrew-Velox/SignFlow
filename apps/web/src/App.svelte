<script lang="ts">
  import { onMount } from 'svelte';
  import DrawingCanvas from './components/DrawingCanvas.svelte';
  import TopBar from './components/TopBar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import ExportPanel from './components/ExportPanel.svelte';
  import { editor } from './stores/editor.svelte';

  onMount(() => editor.init());

  function onKey(e: KeyboardEvent) {
    // Esc always closes the drawer, even from inside one of its fields.
    if (e.key === 'Escape' && editor.exportOpen) {
      editor.exportOpen = false;
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (editor.exportOpen) return; // the canvas is behind the drawer: no canvas shortcuts

    const key = e.key.toLowerCase();
    const meta = e.ctrlKey || e.metaKey;
    if (meta && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (meta && key === 'y') {
      e.preventDefault();
      editor.redo();
    } else if (!meta && !e.altKey) {
      if (key === 'g') editor.showGrid = !editor.showGrid;
      else if (key === 'p') editor.panelOpen = !editor.panelOpen;
      else if (key === 'e') editor.exportOpen = true;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<DrawingCanvas />
<TopBar />
<Toolbar />
{#if editor.panelOpen && !editor.exportOpen}
  <PropertiesPanel />
{/if}
{#if editor.exportOpen}
  <ExportPanel />
{/if}
