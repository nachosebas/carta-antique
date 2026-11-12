(function (root) {
  'use strict';

  const normalize = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ').replace(/\s*\+\s*/gu, '+').toLocaleLowerCase('es');
  const pesos = value => '$' + String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const flag = (object, key, fallback) => own(object, key) ? Boolean(object[key]) : fallback;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const identifier = value => (typeof value === 'string' && value.trim() !== '') || (Number.isSafeInteger(value) && value >= 0);
  const compare = (a, b) => (a.orden || 0) - (b.orden || 0) || String(a.id).localeCompare(String(b.id), 'es', { numeric: true });
  const idKey = value => String(value);

  class CatalogError extends Error {}

  function validate(catalog) {
    const fail = () => { throw new CatalogError('La carta publicada tiene un formato inválido.'); };
    if (!object(catalog) || (own(catalog, 'formato') && catalog.formato !== 1)) fail();
    for (const key of ['zonas', 'familias', 'productos']) {
      if (!Array.isArray(catalog[key])) fail();
      const seen = new Set();
      for (const row of catalog[key]) {
        if (!object(row) || !identifier(row.id) || typeof row.nombre !== 'string' || !row.nombre.trim()) fail();
        if (seen.has(idKey(row.id))) fail();
        seen.add(idKey(row.id));
        if (own(row, 'orden') && !Number.isSafeInteger(row.orden)) fail();
        for (const name of ['activo', 'activa', 'oculto', 'oculta']) {
          if (own(row, name) && ![true, false, 0, 1].includes(row[name])) fail();
        }
      }
    }
    const zones = new Set(catalog.zonas.map(row => idKey(row.id)));
    const families = new Set(catalog.familias.map(row => idKey(row.id)));
    for (const row of catalog.familias) {
      if (!identifier(row.zona_id) || !zones.has(idKey(row.zona_id))) fail();
      if (own(row, 'seccion') && row.seccion !== null && typeof row.seccion !== 'string') fail();
    }
    for (const row of catalog.productos) {
      if (!identifier(row.familia_id) || !families.has(idKey(row.familia_id))) fail();
      if (!Number.isSafeInteger(row.precio) || row.precio < 0) fail();
    }
    return catalog;
  }

  function groupVariants(products) {
    const items = [];
    for (const product of products) {
      const parts = product.nombre.split(/\s+·\s+/u);
      const previous = items[items.length - 1];
      if (parts.length >= 2 && parts[0] && parts.slice(1).join(' · ') && product.ofertas.length === 1) {
        const brand = parts[0].trim();
        const variant = parts.slice(1).join(' · ').trim();
        if (previous && previous.variantes && normalize(previous.marca) === normalize(brand) && previous.ofertas[0].precio === product.ofertas[0].precio) {
          previous.variantes.push(variant);
        } else {
          items.push({ marca: brand, variantes: [variant], ofertas: product.ofertas });
        }
      } else {
        items.push({ nombre: product.nombre, ofertas: product.ofertas });
      }
    }
    return items.map(item => item.variantes && item.variantes.length === 1
      ? { nombre: item.marca + ' · ' + item.variantes[0], ofertas: item.ofertas }
      : item);
  }

  function buildCatalog(input) {
    const catalog = validate(input);
    const sections = new Map();
    const zones = catalog.zonas.filter(zone => ['bar', 'boliche'].includes(normalize(zone.nombre)) && flag(zone, 'activa', true) && !flag(zone, 'oculta', false))
      .slice().sort((a, b) => (normalize(a.nombre) === 'bar' ? 0 : 1) - (normalize(b.nombre) === 'bar' ? 0 : 1) || compare(a, b));
    const allFamilies = catalog.familias.slice().sort(compare);
    const allProducts = catalog.productos.slice().sort(compare);
    for (const zone of zones) {
      const origin = normalize(zone.nombre) === 'bar' ? 'Bar' : 'Boliche';
      for (const family of allFamilies) {
        if (idKey(family.zona_id) !== idKey(zone.id) || !flag(family, 'activa', true) || flag(family, 'oculta', false)) continue;
        const products = allProducts.filter(product => idKey(product.familia_id) === idKey(family.id) && flag(product, 'activo', true) && !flag(product, 'oculto', false) && product.precio > 0);
        if (!products.length) continue;
        const sectionName = (family.seccion || '').trim() || family.nombre.trim();
        const sectionKey = normalize(sectionName);
        if (!sections.has(sectionKey)) sections.set(sectionKey, { nombre: sectionName, familias: new Map() });
        const section = sections.get(sectionKey);
        const familyKey = normalize(family.nombre);
        if (!section.familias.has(familyKey)) section.familias.set(familyKey, { nombre: family.nombre.trim(), productos: new Map() });
        const merged = section.familias.get(familyKey);
        for (const product of products) {
          const key = normalize(product.nombre);
          if (!merged.productos.has(key)) merged.productos.set(key, { nombre: product.nombre.trim().replace(/\s+/gu, ' '), ofertas: [] });
          const entry = merged.productos.get(key);
          let offer = entry.ofertas.find(item => item.precio === product.precio);
          if (!offer) { offer = { precio: product.precio, origenes: [] }; entry.ofertas.push(offer); }
          if (!offer.origenes.includes(origin)) offer.origenes.push(origin);
        }
      }
    }
    const output = [];
    for (const section of sections.values()) {
      const groups = [];
      for (const family of section.familias.values()) {
        const products = [...family.productos.values()].map(product => {
          // Precio público acordado: este vino sigue el precio de Bar, sin cambiar las cajas.
          if (normalize(product.nombre) === 'santa julia dulce') {
            const bar = product.ofertas.find(offer => offer.origenes.includes('Bar'));
            if (bar) return { ...product, ofertas: [bar] };
          }
          return product;
        });
        groups.push({ familia: family.nombre, items: groupVariants(products) });
      }
      if (groups.length === 1 && normalize(groups[0].familia) === normalize(section.nombre)) groups[0].familia = null;
      output.push({ nombre: section.nombre, grupos: groups });
    }
    return { titulo: 'Carta de bebidas', secciones: output, publicado: typeof catalog.publicado === 'string' ? catalog.publicado : null };
  }

  function start(document, window) {
    const status = document.getElementById('estado');
    const message = document.getElementById('mensaje');
    const retry = document.getElementById('reintentar');
    const nav = document.getElementById('categorias');
    const main = document.getElementById('carta');
    const updated = document.getElementById('actualizada');
    const zoneButtons = [...document.querySelectorAll('[data-z]')];
    let loading = false;
    let generation = 0;

    function node(tag, text, className) {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    }

    function selectZone(value, changeHash) {
      const selected = value === 'boliche' ? 'boliche' : 'bar';
      for (const button of zoneButtons) {
        const active = button.getAttribute('data-z') === selected;
        button.classList.toggle('activa', active);
        button.setAttribute('aria-pressed', String(active));
      }
      if (changeHash) {
        try { window.history.replaceState(null, '', '#' + selected); } catch (_) { /* Google Sites puede restringir el historial incrustado. */ }
      }
      // Las dos zonas consultan la misma carta; cambiar de zona no filtra ningún producto.
    }

    function selectSection(index) {
      [...main.children].forEach((section, current) => { section.hidden = current !== index; });
      [...nav.children].forEach((button, current) => {
        button.classList.toggle('activa', current === index);
        button.setAttribute('aria-pressed', String(current === index));
      });
    }

    function render(view) {
      nav.replaceChildren(); main.replaceChildren(); updated.replaceChildren();
      view.secciones.forEach((section, index) => {
        const button = node('button', section.nombre, 'tab');
        button.type = 'button'; button.setAttribute('aria-controls', 'categoria-' + index);
        button.addEventListener('click', () => selectSection(index));
        nav.append(button);
        const content = node('section'); content.id = 'categoria-' + index;
        content.append(node('h2', section.nombre));
        for (const group of section.grupos) {
          if (group.familia) content.append(node('h3', group.familia));
          for (const item of group.items) {
            const row = node('div', undefined, item.variantes ? 'item marca' : 'item');
            row.append(node('span', item.marca || item.nombre, 'n'));
            const price = node('span', undefined, item.ofertas.length > 1 ? 'p conflicto' : 'p');
            if (item.ofertas.length === 1) price.textContent = pesos(item.ofertas[0].precio);
            else for (const offer of item.ofertas) {
              const offerNode = node('span', undefined, 'oferta');
              offerNode.append(node('span', offer.origenes.join(' / ') + ' ', 'origen'), node('span', pesos(offer.precio)));
              price.append(offerNode);
            }
            row.append(price); content.append(row);
            if (item.variantes) content.append(node('div', item.variantes.join(' · '), 'variantes'));
          }
        }
        main.append(content);
      });
      const empty = !view.secciones.length;
      nav.hidden = empty; main.hidden = empty; status.hidden = !empty;
      message.textContent = empty ? 'La carta no tiene bebidas disponibles en este momento.' : '';
      retry.hidden = !empty;
      updated.hidden = true;
      if (view.publicado) {
        const date = new Date(view.publicado);
        if (!Number.isNaN(date.getTime())) {
          updated.textContent = 'Precios actualizados el ' + new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
          updated.hidden = empty;
        }
      }
      if (!empty) selectSection(0);
    }

    async function load() {
      if (loading) return;
      loading = true;
      const current = ++generation;
      status.hidden = false; message.textContent = 'Cargando la carta…'; retry.hidden = true;
      nav.hidden = true; main.hidden = true; updated.hidden = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await window.fetch('./carta.json', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo descargar la carta.');
        const view = buildCatalog(await response.json());
        if (current === generation) render(view);
      } catch (error) {
        if (current !== generation) return;
        nav.replaceChildren(); main.replaceChildren(); updated.replaceChildren();
        nav.hidden = true; main.hidden = true; updated.hidden = true; status.hidden = false;
        message.textContent = error instanceof CatalogError || error instanceof SyntaxError
          ? 'La carta publicada no se pudo leer. Reintentá o consultá al personal.'
          : 'No pudimos cargar la carta. Revisá tu conexión y volvé a intentar.';
        retry.hidden = false;
      } finally {
        window.clearTimeout(timeout); loading = false;
      }
    }

    zoneButtons.forEach(button => button.addEventListener('click', () => selectZone(button.getAttribute('data-z'), true)));
    window.addEventListener('hashchange', () => selectZone(window.location.hash.slice(1), false));
    retry.addEventListener('click', load);
    selectZone(window.location.hash.slice(1), false);
    load();
  }

  const api = { normalize, pesos, validate, groupVariants, buildCatalog, CatalogError, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CartaCompleta = api; start(root.document, root); }
})(typeof window !== 'undefined' ? window : globalThis);
