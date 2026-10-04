import { writable } from 'svelte/store';

/**
 * 导入流程期间自动保存必须停摆：
 * 1. 暂停后，App 里任何挂起的防抖计时器都会被取消，避免旧工作副本迟到落库；
 * 2. 导入只在一次 IndexedDB 事务提交成功后才切换编辑器工程，随后才恢复自动保存，
 *    因此刷新页面 / 事务失败时不会留下被覆盖一半的本地记录。
 */
export const autoSaveEnabled = writable(true);
