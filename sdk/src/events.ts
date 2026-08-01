// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

export class EventEmitter<T extends Record<string, any>> {
  private listeners: { [K in keyof T]?: Array<(arg: T[K]) => void> } = {};

  on<K extends keyof T>(event: K, listener: (arg: T[K]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
  }

  emit<K extends keyof T>(event: K, arg: T[K]) {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      eventListeners.forEach(listener => listener(arg));
    }
  }

  off<K extends keyof T>(event: K, listener: (arg: T[K]) => void) {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      this.listeners[event] = eventListeners.filter(l => l !== listener);
    }
  }
}
