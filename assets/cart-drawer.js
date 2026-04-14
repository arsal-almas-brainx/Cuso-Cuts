import { DialogComponent, DialogOpenEvent, DialogCloseEvent } from '@theme/dialog';
import { CartAddEvent } from '@theme/events';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement} [liveRegion] - The live region for cart announcements when dialog is open.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {AbortController | null} */
  #historyAbortController = null;

  /** @type {EventListenerOrEventListenerObject} */
  #boundCheckGWP;

  /** * GWP Configuration
   * threshold: 10000 (100.00 PKR)
   */
  #GWP_CONFIG = {
    threshold: 10000, 
    giftVariantId: 48598644359424
  };

  constructor() {
    super();
    this.#boundCheckGWP = this.checkGWP.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    
    ['cart:updated', 'cart:refresh', 'cart:changed'].forEach(eventName => {
      document.addEventListener(eventName, this.#boundCheckGWP);
    });

    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.addEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.addEventListener(DialogOpenEvent.eventName, this.#boundCheckGWP);

    if (history.state?.cartDrawerOpen) {
      history.replaceState(null, '');
    }
    
    this.checkGWP();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    
    ['cart:updated', 'cart:refresh', 'cart:changed'].forEach(eventName => {
      document.removeEventListener(eventName, this.#boundCheckGWP);
    });
    this.removeEventListener(DialogOpenEvent.eventName, this.#boundCheckGWP);

    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.removeEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.#historyAbortController?.abort();
  }

  async checkGWP() {
    try {
      // @ts-ignore
      const rootPath = window.Shopify?.routes?.root || '/';
      const response = await fetch(`${rootPath}cart.js`);
      const cart = await response.json();

      const giftItem = cart.items.find((/** @type {any} */ item) => 
        item.variant_id == this.#GWP_CONFIG.giftVariantId
      );
      
      const priceToEvaluate = giftItem ? cart.total_price - giftItem.final_line_price : cart.total_price;

      if (priceToEvaluate >= this.#GWP_CONFIG.threshold && !giftItem) {
        await this.#updateGift(1);
      } 
      else if (priceToEvaluate < this.#GWP_CONFIG.threshold && giftItem) {
        await this.#updateGift(0);
      }
    } catch (e) {
      console.error("GWP Error:", e);
    }
  }

  /**
   * @param {number} quantity 
   */
  async #updateGift(quantity) {
    try {
      // @ts-ignore
      const rootPath = window.Shopify?.routes?.root || '/';
      const endpoint = quantity > 0 ? 'cart/add.js' : 'cart/change.js';
      
      const body = quantity > 0 
        ? JSON.stringify({ items: [{ id: this.#GWP_CONFIG.giftVariantId, quantity: 1 }] })
        : JSON.stringify({ id: this.#GWP_CONFIG.giftVariantId.toString(), quantity: 0 });

      const response = await fetch(`${rootPath}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      });
      
      if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`Shopify API Error: ${errorMsg}`);
      }
      
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      this.#refreshCartUI();
    } catch (e) {
      console.error("GWP Update Error:", e);
    }
  }

  async #refreshCartUI() {
    try {
      // @ts-ignore
      const rootPath = window.Shopify?.routes?.root || '/';
      const response = await fetch(`${rootPath}cart?sections=cart-drawer,cart-icon-bubble`);
      const json = await response.json();
      
      if (json['cart-drawer']) {
        const html = new DOMParser().parseFromString(json['cart-drawer'], 'text/html');
        const newContent = html.querySelector('.cart-drawer__content');
        const currentDrawer = this.querySelector('.cart-drawer__content');
        if (currentDrawer && newContent) {
          currentDrawer.innerHTML = newContent.innerHTML;
        }
      }
      
      if (json['cart-icon-bubble']) {
        const currentBubble = document.querySelector('cart-icon-bubble');
        if (currentBubble) currentBubble.innerHTML = json['cart-icon-bubble'];
      }
    } catch (e) {
      console.error("Cart UI refresh error:", e);
    }
  }

  #handleHistoryOpen = () => {
    if (!isMobileBreakpoint()) return;
    if (!history.state?.cartDrawerOpen) {
      history.pushState({ cartDrawerOpen: true }, '');
    }
    this.#historyAbortController = new AbortController();
    window.addEventListener('popstate', this.#handlePopState, { signal: this.#historyAbortController.signal });
  };

  #handleHistoryClose = () => {
    this.#historyAbortController?.abort();
    if (history.state?.cartDrawerOpen) history.back();
  };

  #handlePopState = async () => {
    if (this.refs.dialog?.open) {
      this.refs.dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
      await this.closeDialog();
      this.refs.dialog.style.removeProperty('--dialog-drawer-closing-animation');
    }
  };

  /**
   * @param {any} event
   */
  #handleCartAdd = (event) => {
    if (this.hasAttribute('auto-open')) this.showDialog();
    this.checkGWP();
    this.#announceCartCount(event.detail.resource?.item_count);
  };

  /**
   * @param {any} cartCount
   */
  #announceCartCount(cartCount) {
    const liveRegion = /** @type {HTMLElement | undefined} */ (this.refs.liveRegion);
    if (!this.refs.dialog?.open || !liveRegion || cartCount === undefined) return;
    // @ts-ignore
    liveRegion.textContent = `${Theme.translations.cart_count}: ${cartCount}`;
  }

  open() {
    this.showDialog();
    this.checkGWP();
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    /** @type {any} */
    const { dialog } = this.refs;
    if (!dialog) return;
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');
    if (!content || !summary) {
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }
    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}