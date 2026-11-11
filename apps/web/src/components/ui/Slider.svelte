<script lang="ts">
  type Props = {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format?: (v: number) => string;
    disabled?: boolean;
  };
  let { label, value = $bindable(), min, max, step, format = (v: number) => v.toFixed(2), disabled = false }: Props = $props();
  const pct = $derived(((value - min) / (max - min)) * 100);
</script>

<label class="slider" class:disabled>
  <span class="row">
    <span class="label">{label}</span>
    <output class="mono">{format(value)}</output>
  </span>
  <input type="range" {min} {max} {step} {disabled} bind:value style="--p:{pct}%" />
</label>

<style>
  .slider {
    display: grid;
    gap: 8px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .label {
    color: var(--text-2);
  }
  output {
    font-size: 12px;
    color: var(--muted);
  }
  .disabled {
    opacity: 0.45;
  }
  input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: max(16px, calc(var(--hit) - 16px));
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  input:disabled {
    cursor: default;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--text) var(--p), var(--hair-strong) var(--p));
  }
  input::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--text) var(--p), var(--hair-strong) var(--p));
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--text);
    transition: transform var(--t-fast) var(--ease);
  }
  input::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--text);
  }
  input:active::-webkit-slider-thumb {
    transform: scale(1.1);
  }
  @media (pointer: coarse) {
    input::-webkit-slider-thumb {
      width: 24px;
      height: 24px;
      margin-top: -10px;
    }
    input::-moz-range-thumb {
      width: 21px;
      height: 21px;
    }
  }
</style>
