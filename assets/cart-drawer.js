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
  /** @type {any} state - Local state for the component */
  state; 
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {AbortController | null} */
  #historyAbortController = null;

  /** @type {EventListenerOrEventListenerObject} */
  #boundCheckGWP;

  /** @type {boolean} */
  #isUpdatingGift = false;

  /** @type {number | null} */
  #checkGWPTimeout = null;

  /** * GWP Configuration
   * threshold: 10000 (100.00 PKR)
   */
  #GWP_CONFIG = {
    threshold: 10000, 
    giftVariantId: 48598644359424
  };

  constructor() {
    super();
    this.#boundCheckGWP = this.#debouncedCheckGWP.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    
    // Listen only to these events to avoid infinite loops
    ['cart:updated', 'cart:changed'].forEach(eventName => {
      document.addEventListener(eventName, this.#boundCheckGWP);
    });

    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.addEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.addEventListener(DialogOpenEvent.eventName, this.#boundCheckGWP);

    if (history.state?.cartDrawerOpen) {
      history.replaceState(null, '');
    }
    
    // Initial check without refresh
    this.#debouncedCheckGWP();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    
    ['cart:updated', 'cart:changed'].forEach(eventName => {
      document.removeEventListener(eventName, this.#boundCheckGWP);
    });
    this.removeEventListener(DialogOpenEvent.eventName, this.#boundCheckGWP);

    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.removeEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.#historyAbortController?.abort();
    
    if (this.#checkGWPTimeout) {
      clearTimeout(this.#checkGWPTimeout);
    }
  }

  /**
   * Debounced version of checkGWP to prevent rapid repeated calls
   */
  #debouncedCheckGWP() {
    if (this.#checkGWPTimeout) {
      clearTimeout(this.#checkGWPTimeout);
    }
    
    this.#checkGWPTimeout = setTimeout(() => {
      this.checkGWP();
    }, 100);
  }

  async checkGWP() {
    // Prevent concurrent executions
    if (this.#isUpdatingGift) {
      return;
    }

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
    // Prevent concurrent updates
    if (this.#isUpdatingGift) {
      return;
    }

    this.#isUpdatingGift = true;

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
      
      // Wait a bit to ensure Shopify has processed the update
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Refresh the UI WITHOUT page reload
      await this.#refreshCartUI();
      
    } catch (e) {
      console.error("GWP Update Error:", e);
    } finally {
      this.#isUpdatingGift = false;
    }
  }

  async #refreshCartUI() {
    try {
      // @ts-ignore
      const rootPath = window.Shopify?.routes?.root || '/';
      
      // Get the drawer state before closing
      const wasOpen = this.refs.dialog?.open;
      
      // Fetch the header section to get updated cart HTML
      const headerSection = document.querySelector('[id*="shopify-section-header"]');
      let sectionId = 'header';
      
      if (headerSection?.id) {
        sectionId = headerSection.id.replace('shopify-section-', '');
      }
      
      // Fetch the updated section
      const response = await fetch(`${window.location.pathname}?section_id=${sectionId}`);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract and update cart drawer inner content
      const newCartInner = doc.querySelector('.cart-drawer__inner');
      const currentCartInner = this.querySelector('.cart-drawer__inner');
      
      if (newCartInner && currentCartInner) {
        // Store scroll position
        const scrollElement = currentCartInner.querySelector('.cart-drawer__content');
        const scrollPos = scrollElement?.scrollTop || 0;
        
        // Replace the content
        currentCartInner.innerHTML = newCartInner.innerHTML;
        
        // Restore scroll position
        const newScrollElement = currentCartInner.querySelector('.cart-drawer__content');
        if (newScrollElement) {
          newScrollElement.scrollTop = scrollPos;
        }
      }
      
      // Update cart bubble with correct count (excluding gift)
      await this.#updateCartBubble();
      
      // Reopen drawer if it was open
      if (wasOpen && !this.refs.dialog?.open) {
        this.showDialog();
      }
      
    } catch (e) {
      console.error("Cart UI refresh error:", e);
      // Fallback: just reload the page
      window.location.reload();
    }
  }

  async #updateCartBubble() {
    try {
      // @ts-ignore
      const rootPath = window.Shopify?.routes?.root || '/';
      const response = await fetch(`${rootPath}cart.js`);
      const cart = await response.json();
      
      // Calculate actual count excluding gift
      let actualCount = cart.item_count;
      const giftItem = cart.items.find((/** @type {any} */ item) => 
        item.variant_id == this.#GWP_CONFIG.giftVariantId
      );
      
      if (giftItem) {
        actualCount -= giftItem.quantity;
      }
      
      // Update all cart bubble instances
      const bubbles = document.querySelectorAll('.cart-bubble__text-count');
      bubbles.forEach(bubble => {
        if (actualCount === 0) {
          bubble.textContent = '';
        } else {
          bubble.textContent = actualCount.toString();
        }
      });
      
      // Also update the cart drawer heading bubble
      const drawerBubbles = this.querySelectorAll('.cart-bubble__text-count');
      drawerBubbles.forEach(bubble => {
        if (actualCount === 0) {
          bubble.textContent = '';
        } else {
          bubble.textContent = actualCount.toString();
        }
      });
      

      const bubbleText = document.getElementById('cart-bubble-text');
      if (bubbleText && actualCount > 0) {
        bubbleText.textContent = `${actualCount}`;
      }
      
    } catch (e) {
      console.error("Cart bubble update error:", e);
    }
  }

  #handleHistoryOpen = () => {
    if (!isMobileBreakpoint()) return;
    if (this.state?.cartDrawerOpen) {
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
    // Check GWP after cart add
    this.#debouncedCheckGWP();
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
    // Check GWP when drawer opens
    this.#debouncedCheckGWP();
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
