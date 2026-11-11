<script lang="ts">
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Trash from '@lucide/svelte/icons/trash';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import IconButton from './ui/IconButton.svelte';
  import { editor } from '../stores/editor.svelte';
  import { mod } from '../lib/platform';
</script>

<div class="toolbar" role="toolbar" aria-label="Canvas tools">
  <IconButton label="Undo" icon={Undo2} keys={[mod, 'Z']} onclick={() => editor.undo()} disabled={!editor.canUndo} />
  <IconButton label="Redo" icon={Redo2} keys={[mod, '⇧', 'Z']} onclick={() => editor.redo()} disabled={!editor.canRedo} />
  <span class="sep" role="separator"></span>
  <IconButton label="Clear canvas" icon={Trash} onclick={() => editor.clear()} disabled={editor.isEmpty} />
  <span class="sep" role="separator"></span>
  <IconButton label={editor.showGrid ? 'Hide grid' : 'Show grid'} icon={Grid3x3} keys={['G']} active={editor.showGrid} onclick={() => (editor.showGrid = !editor.showGrid)} />
  <IconButton label="Pen settings" icon={SlidersHorizontal} keys={['P']} active={editor.panelOpen} onclick={() => (editor.panelOpen = !editor.panelOpen)} />
</div>

<style>
  .toolbar {
    position: fixed;
    left: 50%;
    bottom: var(--edge-b);
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow-float);
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--hair-strong);
  }
</style>
