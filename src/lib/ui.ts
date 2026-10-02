import { writable } from 'svelte/store';

export const locateRequest = writable(0);

export function requestLocateOriginal() {
  locateRequest.update((value) => value + 1);
}
