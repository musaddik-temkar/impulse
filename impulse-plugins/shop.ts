import { FS } from '../lib/fs';

const PATHS = {
  SHOP: 'impulse-db/shop.json',
  RECEIPTS: 'impulse-db/receipts.json'
};

interface ShopItem {
  name: string;
  price: number;
  description: string;
}

interface Receipt {
  receiptId: string;
  userId: string;
  timestamp: number;
  itemName: string;
  amount: number;
}

type ShopData = { items: ShopItem[] };
type ReceiptsData = { [userId: string]: Receipt[] };

class Shop {
  private static shopData: ShopData = Shop.loadData<ShopData>(PATHS.SHOP, { items: [] });
  private static receiptsData: ReceiptsData = Shop.loadData<ReceiptsData>(PATHS.RECEIPTS, {});

  private static loadData<T>(path: string, defaultValue: T): T {
    try {
      const data = FS(path).readIfExistsSync();
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private static saveData(path: string, data: any): void {
    try {
      FS(path).writeUpdate(() => JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error saving data to ${path}:`, error);
    }
  }

  static getShopItems(): ShopItem[] {
    return this.shopData.items.sort((a, b) => a.name.localeCompare(b.name));
  }

  static addItem(name: string, price: number, description: string): void {
    this.shopData.items.push({ name, price, description });
    this.saveData(PATHS.SHOP, this.shopData);
  }

  static deleteItem(itemName: string): string {
    const initialLength = this.shopData.items.length;
    this.shopData.items = this.shopData.items.filter(item => item.name !== itemName);
    
    if (this.shopData.items.length === initialLength) {
      return `Item "${itemName}" not found in the shop.`;
    }
    
    this.saveData(PATHS.SHOP, this.shopData);
    return `Item "${itemName}" has been removed from the shop.`;
  }

  static buyItem(userid: string, itemName: string): string {
    const item = this.shopData.items.find(item => item.name === itemName);
    if (!item) return `Item "${itemName}" not found in the shop.`;

    const userBalance = Economy.readMoney(userid);
    if (userBalance < item.price) {
      return `You do not have enough ${Impulse.currency} to buy "${itemName}".`;
    }

    Economy.takeMoney(userid, item.price, `Purchase of "${itemName}"`);
    
    const receipt: Receipt = {
      receiptId: Impulse.generateRandomString(10),
      userId: userid,
      timestamp: Date.now(),
      itemName: item.name,
      amount: item.price,
    };

    if (!this.receiptsData[userid]) this.receiptsData[userid] = [];
    this.receiptsData[userid].unshift(receipt);
    this.saveData(PATHS.RECEIPTS, this.receiptsData);

    return `You successfully purchased "${itemName}" for ${item.price} ${Impulse.currency}. Your receipt ID is: ${receipt.receiptId}`;
  }

  static getUserReceipts(userid: string): Receipt[] {
    return this.receiptsData[userid] || [];
  }

  static getAllReceipts(filterUserid?: string): Receipt[] {
    return Object.entries(this.receiptsData)
      .filter(([userId]) => !filterUserid || userId === filterUserid)
      .flatMap(([, receipts]) => receipts)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const commands: ChatCommands = {
  shop(target, room, user) {
    if (!this.runBroadcast()) return;
    const items = Shop.getShopItems();
    if (!items.length) return this.sendReplyBox(`<b>The shop is currently empty.</b>`);

    const tableData = items.map(item => [
      item.name,
      item.description,
      item.price.toString(),
      `<button name="send" value="/buyitem ${item.name}" style="padding: 5px 10px; background-color: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">Buy</button>`,
    ]);

    this.ImpulseReplyBox(Impulse.generateThemedTable('Impulse Shop', ['Item', 'Description', 'Price', 'Buy'], tableData));
  },

  buyitem(target, room, user) {
    if (!target) return this.sendReply(`Usage: /buyitem [item name]`);
    this.sendReply(Shop.buyItem(user.id, target));
  },

  additem(target, room, user) {
    this.checkCan('globalban');
    const [name, priceStr, ...descParts] = target.split(',').map(s => s.trim());
    
    if (!name || !priceStr || !descParts.length) {
      return this.sendReply(`Usage: /additem [item name], [price], [description]`);
    }

    const price = parseInt(priceStr, 10);
    if (isNaN(price) || price <= 0) return this.sendReply(`Please specify a valid positive price.`);

    Shop.addItem(name, price, descParts.join(', '));
    this.sendReplyBox(`Item "${name}" added to the shop for ${price} ${Impulse.currency}.`);
  },

  deleteitem(target, room, user) {
    this.checkCan('globalban');
    if (!target) return this.sendReply(`Usage: /deleteitem [item name]`);
    this.sendReplyBox(Shop.deleteItem(target));
  },

  receipts(target, room, user) {
    if (!this.runBroadcast()) return;
    const receipts = Shop.getUserReceipts(user.id);
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });

    const header = ['Receipt ID', 'Time of Purchase', 'Item Name', `Amount (${Impulse.currency})`];
    const data = receipts.map(r => [
      r.receiptId,
      dateFormatter.format(r.timestamp),
      r.itemName,
      r.amount.toString()
    ]);

    const table = Impulse.generateThemedTable('Your Purchase Receipts', header, data);
    this.ImpulseReplyBox(`<div style="max-height: 400px; overflow-y: auto;">${table}</div>`);
  },

  receiptlogs(target, room, user) {
    this.checkCan('globalban');
    if (!this.runBroadcast()) return;
    
    const filterUserid = toID(target);
    const receipts = Shop.getAllReceipts(filterUserid);
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });

    const header = ['Receipt ID', 'User ID', 'Time of Purchase', 'Item Name', `Amount (${Impulse.currency})`];
    const data = receipts.map(r => [
      r.receiptId,
      r.userId,
      dateFormatter.format(r.timestamp),
      r.itemName,
      r.amount.toString()
    ]);

    const title = `Purchase Logs ${filterUserid ? `for ${filterUserid}` : ''}`;
    const table = Impulse.generateThemedTable(title, header, data);
    this.ImpulseReplyBox(`<div style="max-height: 400px; overflow-y: auto;">${table}</div>`);
  },

  shophelp(target, room, user) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<b><center>Shop Commands</center></b><br>` +
      `<b>User Commands</b><br>` +
      `<ul>` +
      `<li><b>/shop</b> - View available items in the shop.</li>` +
      `<li><b>/buyitem [item name]</b> - Purchase an item from the shop.</li>` +
      `<li><b>/receipts</b> - View your purchase receipts.</li>` +
      `<li><b>/shophelp</b> - Shows this help message.</li>` +
      `</ul><br>` +
      `<b>Admin Commands</b> (Requires: @ and higher)<br>` +
      `<ul>` +
        `<li><b>/additem [item name], [price], [description]</b> - Add an item to the shop.</li>` +
        `<li><b>/deleteitem [item name]</b> - Remove an item from the shop.</li>` +
        `<li><b>/receiptlogs [userid]</b> - View purchase logs, optionally filtered by [userid].</li>` +
      `</ul>`
    );
  },
};
