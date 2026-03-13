import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.js';
import { SdkError } from '../errors.js';
import type { Order } from './types.js';

const ORDERS_FILE = path.join(CONFIG_DIR, 'orders.json');

export interface OrdersStore {
  orders: Order[];
}

export function loadOrders(): OrdersStore {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
    return JSON.parse(raw) as OrdersStore;
  } catch {
    return { orders: [] };
  }
}

export function saveOrders(store: OrdersStore): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function addOrder(order: Order): void {
  const store = loadOrders();
  store.orders.push(order);
  saveOrders(store);
}

export function getOrder(id: string): Order | null {
  const store = loadOrders();
  return store.orders.find((o) => o.id === id) || null;
}

export function updateOrder(id: string, updates: Partial<Order>): void {
  const store = loadOrders();
  const index = store.orders.findIndex((o) => o.id === id);
  if (index === -1) {
    throw new SdkError('ORDER_NOT_FOUND', `Order "${id}" not found`);
  }
  store.orders[index] = { ...store.orders[index], ...updates, updatedAt: new Date().toISOString() };
  saveOrders(store);
}
