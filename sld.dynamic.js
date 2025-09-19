// Konva 9+

console.log("sld.js yüklendi");

window.addEventListener("DOMContentLoaded", function() {
	(function() {
		const STORAGE_KEY = "sld:current";
		const GRID = 20;
		const GRID_COLOR = "#d0d0d0"; // biraz koyu olsun ki net görünsün
		const stageDiv = document.getElementById('stage');
		const palette = document.getElementById('palette');

		if (!stageDiv) {
			console.error('#stage bulunamadı. HTML’de tek bir <div id="stage"></div> olduğundan emin ol.');
			return;
		}



		// Bazı yerleşimlerde #stage genişliği CSS'ten gelmeyebilir; garantiye al
		try {
			stageDiv.style.width = "100%";
			stageDiv.style.height = "100vh"; // üstte sabit header yoksa tam ekran
		} catch (_) { }

		function calcSize() {
			// Öncelik: parent genişliği → yoksa pencere – palet genişliği
			const parent = stageDiv.parentElement;
			const W = (parent && parent.clientWidth) || (window.innerWidth - (palette?.offsetWidth || 0));
			const H = (parent && parent.clientHeight) || window.innerHeight;
			return { W: Math.max(320, W), H: Math.max(240, H) };
		}

		// 1) Stage
		const init = calcSize();
		const stage = new Konva.Stage({ container: "stage", width: init.W, height: init.H });
		console.log("stage size:", init.W, init.H);
		stageDiv.style.outline = "2px dashed #999"; // sadece görsel kontrol


		// 2) Layers
		const gridLayer = new Konva.Layer({ listening: false });
		const layer = new Konva.Layer();
		stage.add(gridLayer);
		stage.add(layer);

		// 3) Grid
		drawGrid();


		function rebuildFromBackendSchema(data) {
			try {
				if (!data) return;

				const fit = calcSize();
				const cs = data.cizimYapisi || {};
				stage.size({
					width: Math.max(fit.W, Number(cs.genislik) || fit.W),
					height: Math.max(fit.H, Number(cs.uzunluk) || fit.H)
				});


				const list = Array.isArray(data.techizat_listesi) ? data.techizat_listesi : [];

				// 2) Önce baraları oluştur
				const barItems = list.filter(it => (it.techizat_turu || '').toUpperCase() === 'BARA');
				const idMap = new Map(); // backend_bara_id -> bizim_bara_id (string)
				const spacing = GRID * 9;         // otomatik yerleşim aralığı
				const startX = GRID * 8;
				const baseY = GRID * 12;

				barItems.forEach((b, i) => {
					// Koordinat verilmemişse otomatik diz
					const x = snap(b.x ?? (startX + i * spacing));
					const y = snap(b.y ?? baseY);
					// Tip bilgisi yoksa varsayılanı ANABARA yapıyoruz (istersen JUNCTION da seçebilirsin)
					const tip = (b.bar_tipi || 'ANABARA').toUpperCase();
					// Bizim sistemde bara_id string; backend’inkini korumak için "BARA_<id>" verelim
					const created = createBara(x, y, tip, `BARA_${b.techizat_id}`);
					idMap.set(b.techizat_id, created.getAttr('techizat_id'));
				});

				// 3) İki baralı bağlantıları (şimdilik HAT) bağla
				const hatItems = list.filter(it => (it.techizat_turu || '').toUpperCase() === 'HAT');
				hatItems.forEach(h => {
					const from = idMap.get(h.baslangic_bara_id);
					const to = idMap.get(h.bitis_bara_id);
					if (from && to) {
						connectTwoBar('HAT', from, to, {}); // gerekirse knee/renk vs. eklenir
					}
				});

				// 4) (İleride ihtiyaç olursa) tek baralı ekipmanları burada handle edebilirsin
				// const singleItems = list.filter(it => ['UNITE','YUK',...].includes(it.techizat_turu?.toUpperCase()));
				// ...

				layer.draw();
			} catch (err) {
				console.error('Backend şema çizim hatası:', err);
			}
		}


		// ======================
		// Grid
		// ======================

		function drawGrid() {
			gridLayer.destroyChildren();
			const W = stage.width();
			const H = stage.height();

			// Hız için tek grup içinde tüm çizgiler
			const g = new Konva.Group({ listening: false });
			for (let x = 0; x <= W; x += GRID) {
				g.add(
					new Konva.Line({
						points: [x, 0, x, H],
						stroke: GRID_COLOR,
						strokeWidth: 1,
					})
				);
			}
			for (let y = 0; y <= H; y += GRID) {
				g.add(
					new Konva.Line({
						points: [0, y + 0.5, W, y + 0.5],
						stroke: GRID_COLOR,
						strokeWidth: 1,
					})
				);
			}
			gridLayer.add(g);
			gridLayer.batchDraw();
		}

		drawGrid();

		// Resize → hep tüm ekranı kapla
		function resizeStage() {
			const s = calcSize();
			stage.size({ width: s.W, height: s.H });
			drawGrid();
			layer.batchDraw();
		}
		window.addEventListener("resize", resizeStage);

		const snap = (v) => Math.round(v / GRID) * GRID;

		// ======================
		// Transformer
		// ======================
		let tr = new Konva.Transformer({ padding: 6, rotateEnabled: true });
		layer.add(tr);

		// === Mini seçim menüsü (Taşı / Çevir) ===
		let selMenu = null, selectedNode = null;

		function ensureSelMenu() {
			if (selMenu) return selMenu;
			selMenu = document.createElement('div');
			selMenu.className = 'sld-mini-menu';
			Object.assign(selMenu.style, {
				position: 'absolute',
				display: 'none',
				gap: '6px',
				padding: '6px',
				background: '#fff',
				border: '1px solid #ccc',
				borderRadius: '8px',
				boxShadow: '0 4px 12px rgba(0,0,0,.15)',
				zIndex: 9999,
				fontFamily: 'Segoe UI, Arial, sans-serif',
			});

			const mkBtn = (label) => {
				const b = document.createElement('button');
				b.textContent = label;
				Object.assign(b.style, {
					padding: '6px 10px', border: '1px solid #bbb', borderRadius: '6px',
					background: '#f7f7f7', cursor: 'pointer'
				});
				b.onmouseenter = () => b.style.background = '#eee';
				b.onmouseleave = () => b.style.background = '#f7f7f7';
				return b;
			};

			const btnMove = mkBtn('Taşı');
			const btnRotate = mkBtn('Çevir');

			btnMove.onclick = () => {
				if (!selectedNode) return;
				// Sürüklemeyi aç, transformer’ı gizle
				selectedNode.draggable(true);
				tr.nodes([]);
				hideSelectionMenu();
				stage.container().style.cursor = 'move';
			};

			btnRotate.onclick = () => {
				if (!selectedNode) return;
				// Sadece döndürme: resize ankrajlarını gizle, rotate açık
				tr.nodes([selectedNode]);
				tr.enabledAnchors([]);      // yalnız çevirme kolu
				tr.rotateEnabled(true);
				hideSelectionMenu();
			};

			selMenu.append(btnMove, btnRotate);
			document.body.appendChild(selMenu);
			return selMenu;
		}

		function showSelectionMenu(node) {
			selectedNode = node;
			const m = ensureSelMenu();
			const r = node.getClientRect();
			const sb = stage.container().getBoundingClientRect();
			// menüyü objenin sağ-üstüne koy
			m.style.left = (sb.left + r.x + r.width + 8) + 'px';
			m.style.top = (sb.top + r.y - 6) + 'px';
			m.style.display = 'flex';
		}

		function hideSelectionMenu() {
			if (selMenu) selMenu.style.display = 'none';
			selectedNode = null;
		}

		// Boş sahneye tıklayınca menüyü kapat
		stage.on('click.selmenu', (e) => {
			if (e.target === stage) {
				hideSelectionMenu();
				tr.nodes([]);
			}
		});
		// ESC ile menüyü kapat
		stage.container().addEventListener('keydown', (e) => {
			if (e.key === 'Escape') { hideSelectionMenu(); tr.nodes([]); }
		});


		// Klavye odağı
		const container = stage.container();
		container.tabIndex = 1;
		container.style.outline = "none";
		container.addEventListener("mousedown", () => container.focus());
		container.focus();

		// ======================
		// Veri yapıları (bar + ekler + bağlantılar)
		// ======================
		const bars = new Map(); // Map<bara_id, {node, tur_id}>
		const attachments = []; // tek baralı ekipmanlar
		const connections = []; // iki baralı: HAT/TRAFO/ANAHTAR/SERI_KAPASITOR

		// ID üretici
		let __idCounter = 0;
		function newId(prefix = "EQ") {
			__idCounter += 1;
			return `${prefix}_${Date.now()}_${__idCounter}`;
		}

		// ======================
		// Yardımcılar
		// ======================

		function selectable(node) {
		  // Seçim / mini menü (aynı)
		  node.on("click", (e) => {
		    if (activeTool) return;
		    e.cancelBubble = true;
		    tr.nodes([node]);
		    tr.enabledAnchors([]);
		    tr.rotateEnabled(false);
		    layer.draw();
		    showSelectionMenu(node);
		  });

		  // --- TERSİNE-BAĞLI TAŞIMA ---
		  // Bu node hangi baralara bağlı? (tek-baralı veya iki-baralı)
		  function connectedBarIdsOf(node) {
		    const ids = new Set();

		    const a = attachments.find((x) => x.node === node);
		    if (a) ids.add(a.barId);

		    const c = connections.find((x) => x.node === node);
		    if (c) { ids.add(c.from); ids.add(c.to); }

		    return [...ids];
		  }

		  // Drag başlangıcında referansları kaydet
		  node.on("dragstart", () => {
		    node.setAttr("__dragStart", { x: node.x(), y: node.y() });

		    const barIds = connectedBarIdsOf(node);
		    const origins = {};
		    barIds.forEach((bid) => {
		      const b = bars.get(bid)?.node;
		      if (b) origins[bid] = { x: b.x(), y: b.y() };
		    });
		    node.setAttr("__barOrigins", origins);
		  });

		  // Drag sırasında: bağlı baraları da aynı delta kadar taşı
		  node.on("dragmove", () => {
		    const start = node.getAttr("__dragStart");
		    const origins = node.getAttr("__barOrigins") || {};
		    const hasBars = Object.keys(origins).length > 0;

		    // Eğer bu node bir ek/bağlantı değilse (metin vs.), eski davranış
		    if (!hasBars) {
		      const a = attachments.find((x) => x.node === node);
		      if (a) updateAttachmentLink(a);
		      return;
		    }

		    const dx = node.x() - start.x;
		    const dy = node.y() - start.y;

		    // Bağlı tüm baraları taşı (anlık olarak snap uygulamıyoruz, dragend'de yapacağız)
		    Object.entries(origins).forEach(([bid, p0]) => {
		      const b = bars.get(bid)?.node;
		      if (!b) return;
		      b.position({ x: p0.x + dx, y: p0.y + dy });
		      updateBarLinks(bid); // bunun içinde tüm linkler/ekler güncellenir
		    });

		    layer.batchDraw();
		  });

		  // Drag bitince: baraları gride oturt
		  node.on("dragend", () => {
		    const origins = node.getAttr("__barOrigins") || {};
		    const barIds = Object.keys(origins);

		    if (barIds.length) {
		      barIds.forEach((bid) => {
		        const b = bars.get(bid)?.node;
		        if (!b) return;
		        b.position({ x: snap(b.x()), y: snap(b.y()) });
		        updateBarLinks(bid);
		      });

		      // Bu node bir bağlantıysa (ANAHTAR/TRAFO/SERI_KAPASITOR/HAT) emin olmak için yeniden route et
		      const c = connections.find((x) => x.node === node);
		      if (c) rerouteConnection(c);
		    }

		    // Her durumda taşıma sonrası grid'e oturt
		    node.position({ x: snap(node.x()), y: snap(node.y()) });

		    // Eski ek/bağlantı davranışıyla uyum
		    const a = attachments.find((x) => x.node === node);
		    if (a) updateAttachmentLink(a);

		    layer.batchDraw();
		  });

		  // (Önceki grid’e oturtma davranışı — bar olmayan düğümler için)
		  node.on("dragend", () => {
		    // Bu ikinci handler öncekiyle çakışmaz; sadece bar bağlantısı olmayanlar için anlamlı.
		    const a = attachments.find(x => x.node === node);
		    if (!a) node.position({ x: snap(node.x()), y: snap(node.y()) });
		    layer.batchDraw();
		  });
		}

		// hedef node'dan yukarı doğru çıkarak bir BARA grubu var mı bul
		function findBaraGroupFromTarget(target) {
			if (!target || !target.getStage) return null;
			return target.findAncestor(
				n => n.getAttr && n.getAttr('techizat_turu') === 'BARA',
				true
			) || null;
		}


		function getNodeAbs(node) {
			const a = node.getAbsolutePosition();
			return { x: a.x, y: a.y };
		}

		// Bar geometri/port
		function barLengthFor(tur) {
			if ((tur || "").toUpperCase() === "ANABARA") return 140; // -70..+70
			if ((tur || "").toUpperCase() === "URETIM_BARASI") return 80; // -40..+40
			return 0; // junction
		}

		function registerBar(bara_id, node, tur_id) {
		  bars.set(bara_id, { node, tur_id });

		  node.on("dragmove", () => updateBarLinks(bara_id));

		  node.on("dragend", () => {
		    node.position({ x: snap(node.x()), y: snap(node.y()) });
		    updateBarLinks(bara_id);   // snap sonrası tüm linkleri yeniden çiz
		  });
		}

		function getBarPort(bara_id) {
			const ent = bars.get(bara_id);
			if (!ent) return { x: 0, y: 0 };
			const n = ent.node;
			const abs = n.getAbsolutePosition();
			return { x: abs.x, y: abs.y };
		}

		function getBarAttachPoint(bara_id, pointerX) {
			const ent = bars.get(bara_id);
			if (!ent) return null;
			const g = ent.node;
			const center = g.getAbsolutePosition();
			const len = g.getAttr("bar_len") || 0;
			if (len > 0) {
				const half = len / 2;
				const x = Math.max(center.x - half, Math.min(pointerX, center.x + half));
				return { x, y: center.y, relX: x - center.x };
			}
			return { x: center.x, y: center.y, relX: 0 };
		}
		
		 //trafoyu baraların birbirine bakan uclarından bağla
		 // hedef {x,y} veya sadece x (eski kullanım) kabul eder
		 function barFacingEnd(baraId, target) {
		   const ent = bars.get(baraId);
		   if (!ent) return null;
		   const g = ent.node;
		   const L = g.getAttr('bar_len') || barLengthFor(ent.tur_id) || 0;
		   const c = g.getAbsolutePosition();
		   if (L <= 0) return { x: c.x, y: c.y };

		   const t = (typeof target === 'number') ? { x: target, y: c.y } : (target || { x: c.x, y: c.y });

		   // Bara neredeyse yatay ise eski mantık
		   const rot180 = Math.abs(((g.rotation() || 0) % 180 + 180) % 180);
		   const nearlyHoriz = rot180 <= 10 || rot180 >= 170;
		   const half = L / 2;

		   if (nearlyHoriz) {
		     const x = (t.x >= c.x) ? (c.x + half) : (c.x - half);
		     return { x, y: c.y };
		   }

		   // Dönmüş bar: yön vektörüyle projeksiyon
		   const rad = (g.rotation() || 0) * Math.PI / 180;
		   const dirx = Math.cos(rad), diry = Math.sin(rad);
		   const A = { x: c.x - dirx * half, y: c.y - diry * half };
		   const B = { x: c.x + dirx * half, y: c.y + diry * half };
		   const vx = t.x - c.x, vy = t.y - c.y;
		   const proj = vx * dirx + vy * diry;
		   return proj >= 0 ? B : A;
		 }



		// Bar hover tespiti (evt.target bağımlılığından kurtul)
		const BAR_HIT_Y = 14;
		const BAR_HIT_X_PAD = 8;
		function hoveredBarAt(pos) {
			let best = null,
				bestScore = Infinity;
			bars.forEach(({ node, tur_id }, id) => {
				const L = barLengthFor(tur_id);
				const c = node.getAbsolutePosition();
				if (L <= 0) {
					const d = Math.hypot(pos.x - c.x, pos.y - c.y);
					if (d < BAR_HIT_Y && d < bestScore) {
						best = { id, attachPoint: { x: c.x, y: c.y }, relX: 0 };
						bestScore = d;
					}
				} else {
					const half = L / 2;
					const inX = pos.x >= c.x - half - BAR_HIT_X_PAD && pos.x <= c.x + half + BAR_HIT_X_PAD;
					const dy = Math.abs(pos.y - c.y);
					if (inX && dy < BAR_HIT_Y && dy < bestScore) {
						const relX = Math.max(-half, Math.min(half, snap(pos.x - c.x)));
						best = { id, attachPoint: { x: c.x + relX, y: c.y }, relX };
						bestScore = dy;
					}
				}
			});
			return best;
		}

		// Port ofsetleri
		function portOffsetFor(node, side = "single") {
			const t = (node.getAttr("techizat_turu") || "").toUpperCase();
			if (t === "UNITE") return { x: 0, y: -60 };
			if (t === "DEPOLAMA_UNITESI") return { x: 0, y: -46 };
			if (t === "YUK" || t === "IC_IHTIYAC") return { x: 0, y: -36 };
			if (t === "LISANSSIZ_SANTRAL") return { x: 0, y: -64 };
			if (t === "ULUSLARARASI_BAGLANTI") return { x: 0, y: -36 };
			if (t === "ANAHTAR") return side === "left" ? { x: -50, y: 0 } : { x: 50, y: 0 };
			if (t === "TRAFO") return side === "left" ? { x: -60, y: 0 } : { x: 60, y: 0 };
			if (t === "SERI_KAPASITOR") return side === "top" ? { x: 0, y: -52 } : { x: 0, y: 52 };
			return { x: 0, y: -40 };
		}
		function getPortAbs(node, side = "single") {
			const c = getNodeAbs(node);
			const off = portOffsetFor(node, side);
			return { x: c.x + off.x, y: c.y + off.y };
		}

		// ======================
		// Bağlantı güncelleme (tek-baralı)
		// ======================
		function ensureAttachmentLink(a) {
			if (!a.link) {
				a.link = new Konva.Line({
					points: [0, 0, 0, 0],
					stroke: a.node.getAttr("renk_kodu") || "#444",
					strokeWidth: 3,
					listening: false,
				});
				layer.add(a.link);
				a.link.moveToBottom();
			}
			return a.link;
		}

		function updateAttachmentLink(a) {
			const barOrigin = getBarPort(a.barId);
			const pBar = { x: barOrigin.x + (a.relX || 0), y: barOrigin.y };
			const pEq = getPortAbs(a.node, "single");
			ensureAttachmentLink(a).points([pBar.x, pBar.y, pEq.x, pEq.y]);
		}

		function updateBarLinks(bara_id) {
			const barOrigin = getBarPort(bara_id);

			attachments
				.filter((a) => a.barId === bara_id)
				.forEach((a) => {
					const x = barOrigin.x + (a.relX || 0);
					const y = barOrigin.y + (a.offset ?? 60);
					a.node.position({ x, y });
					updateAttachmentLink(a);
				});

			connections
				.filter((c) => c.from === bara_id || c.to === bara_id)
				.forEach((c) => rerouteConnection(c));

			layer.batchDraw();
		}

		// ======================
		// İki uç bağlantı yardımcıları 
		// ======================
		const TRAFO_Y_OFFSET = GRID * 3;  // 20x3 = 80px aşağıda konumlandır

		function ensureTrafoLinks(conn) {
		  if (!conn.linkL) {
		    conn.linkL = new Konva.Line({
		      points: [0, 0, 0, 0],
		      stroke: conn.baslangic_renk_kodu || conn.node.getAttr("renk_kodu") || "#666",
		      strokeWidth: 3,
		      lineJoin: "miter",
		      lineCap: "butt",
		      listening: false,
		    });
		    layer.add(conn.linkL);
		    conn.linkL.moveToBottom();
		  }
		  if (!conn.linkR) {
		    conn.linkR = new Konva.Line({
		      points: [0, 0, 0, 0],
		      stroke: conn.bitis_renk_kodu || conn.node.getAttr("renk_kodu") || "#666",
		      strokeWidth: 3,
		      lineJoin: "miter",
		      lineCap: "butt",
		      listening: false,
		    });
		    layer.add(conn.linkR);
		    conn.linkR.moveToBottom();
		  }
		}

		// === TRAFOnun baraların altında olması için ===
		function updateTrafoLinks(conn) {
		  if (!conn || !conn.node) return;
		  ensureTrafoLinks(conn);

		  // Barların birbirine bakan UÇLARI
		  const Aport = barFacingEnd(conn.from, getBarPort(conn.to));
		  const Bport = barFacingEnd(conn.to,   getBarPort(conn.from));

		  // Trafonun hedef konumu: baraların ALTINDA sabit bir mesafe
		  const targetY = Math.max(Aport.y, Bport.y) + TRAFO_Y_OFFSET;
		  const centerX = (Aport.x + Bport.x) / 2;

		  conn.node.position({ x: centerX, y: targetY });

		  // Trafo portları (soldan/sağdan)
		  const pL = getPortAbs(conn.node, "left");
		  const pR = getPortAbs(conn.node, "right");

		  // L-şekilli: bar UCU -> dikey aşağı -> trafo portu hizasına yatay
		  conn.linkL.points([ Aport.x, Aport.y,  Aport.x, pL.y,  pL.x, pL.y ]);
		  conn.linkR.points([ Bport.x, Bport.y,  Bport.x, pR.y,  pR.x, pR.y ]);
		}


		// Çizim elemanları

			function setNodeColorBy(node) {
			const durum = node.getAttr("isletme_durum") || "SERVISTE";
			let base = node.getAttr("renk_kodu");
			if (!base) {
				const sh = node.findOne((n) => ["Line", "Circle", "Rect", "Arrow"].includes(n.className) && (n.stroke() || n.fill()));
				base = (sh && (sh.stroke() || sh.fill())) || "#000";
				node.setAttr("renk_kodu", base);
			}
			const col = durum === "SERVIS_HARICI" ? "gray" : base;
			node
				.find((n) => ["Line", "Circle", "Rect", "Arrow", "Text"].includes(n.className))
				.forEach((ch) => {
					if (ch.stroke()) ch.stroke(col);
					if (ch.fill()) ch.fill(col);
				});
		}

		function enableDurumToggle(node) {
			node.on("dblclick", () => {
				const curr = node.getAttr("isletme_durum") || "SERVISTE";
				const next = curr === "SERVISTE" ? "SERVIS_HARICI" : "SERVISTE";
				node.setAttr("isletme_durum", next);
				setNodeColorBy(node);
				layer.batchDraw();
			});
		}

		function createBara(x, y, tur_id = "JUNCTION", bara_id) {
			const id = bara_id || newId("BARA");
			const tip = (tur_id || "JUNCTION").toUpperCase();
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "BARA", techizat_id: id, techizat_adi: tip, isletme_durum: "SERVISTE", renk_kodu: "#cc0000" });
			if (tip === "ANABARA") {
				g.add(new Konva.Line({ points: [-70, 0, 70, 0], stroke: "#cc0000", strokeWidth: 5, lineCap: "round" }));
				g.setAttr("bar_len", 140);
			} else if (tip === "URETIM_BARASI") {
				g.add(new Konva.Line({ points: [-40, 0, 40, 0], stroke: "#cc0000", strokeWidth: 5, lineCap: "round" }));
				g.setAttr("bar_len", 80);
			} else {
				g.add(new Konva.Circle({ radius: 7, fill: "#cc0000" }));
				g.setAttr("bar_len", 0);
			}
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			registerBar(id, g, tip);
			return g;
		}

		function createSwitchSymbol(x, y, color = "#e03131") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "ANAHTAR", techizat_adi: "SW", isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			g.add(new Konva.Line({ points: [-50, 0, -15, 0], stroke: color, strokeWidth: 3 }));
			g.add(new Konva.Line({ points: [-15, 0, 15, -10], stroke: color, strokeWidth: 3 }));
			g.add(new Konva.Line({ points: [15, 0, 50, 0], stroke: color, strokeWidth: 3 }));
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createSeriKapasitorSymbol(x, y, color = "#4a4642") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "SERI_KAPASITOR", techizat_adi: "SERI_KAPASITOR", isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			const s = 3,
				L = 48,
				gapY = 12,
				lead = 52;
			g.add(new Konva.Line({ points: [0, -lead, 0, -(gapY + 4)], stroke: color, strokeWidth: s, lineCap: "round" }));
			g.add(new Konva.Line({ points: [-L / 2, -gapY, L / 2, -gapY], stroke: color, strokeWidth: s, lineCap: "round" }));
			g.add(new Konva.Line({ points: [-L / 2, gapY, L / 2, gapY], stroke: color, strokeWidth: s, lineCap: "round" }));
			g.add(new Konva.Line({ points: [0, gapY + 4, 0, lead], stroke: color, strokeWidth: s, lineCap: "round" }));
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createTrafoSymbol(x, y, leftColor = '#f08c00', rightColor = '#f08c00') {
			const g = new Konva.Group({ x, y, draggable: true }); selectable(g);
			g.setAttrs({ techizat_turu: 'TRAFO', techizat_adi: 'TR', isletme_durum: 'SERVISTE' });
			g.add(new Konva.Line({ points: [-60, 0, -25, 0], stroke: leftColor, strokeWidth: 3 }));
			g.add(new Konva.Circle({ x: -8, y: 0, radius: 11, stroke: leftColor, strokeWidth: 3 }));
			g.add(new Konva.Circle({ x: 8, y: 0, radius: 11, stroke: rightColor, strokeWidth: 3 }));
			g.add(new Konva.Line({ points: [25, 0, 60, 0], stroke: rightColor, strokeWidth: 3 }));
			enableDurumToggle(g); setNodeColorBy(g); layer.add(g); return g;
		}

		function createLisanssizSantral(x, y, color = "#000") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "LISANSSIZ_SANTRAL", techizat_adi: "LISANSSIZ_SANTRAL", isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			const r = 30,
				stroke = 3,
				stemTopY = -64;
			g.add(new Konva.Circle({ x: 0, y: stemTopY, radius: 5, fill: color }));
			g.add(new Konva.Line({ points: [0, stemTopY, 0, -r], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(new Konva.Circle({ x: 0, y: 0, radius: r, stroke: color, strokeWidth: stroke }));
			const clipped = new Konva.Group({
				clipFunc: (ctx) => {
					ctx.beginPath();
					ctx.arc(0, 0, r - stroke * 0.6, 0, Math.PI * 2);
					ctx.closePath();
				},
			});
			const sep = 18,
				yTop = -sep / 2,
				yBot = sep / 2;
			const spanX = 20,
				gapX = 2,
				xC = -12,
				xL = xC - spanX / 2,
				xR = xC + spanX / 2;
			const xC2 = xC + gapX + spanX,
				xL2 = xC2 - spanX / 2,
				xR2 = xC2 + spanX / 2;
			clipped.add(new Konva.Line({ points: [-r, yTop, r, yTop], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			clipped.add(new Konva.Line({ points: [-r, yBot, r, yBot], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			clipped.add(new Konva.Line({ points: [xL, yBot, xC, yTop], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			clipped.add(new Konva.Line({ points: [xC, yTop, xR, yBot], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			clipped.add(new Konva.Line({ points: [xL2, yTop, xC2, yBot], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			clipped.add(new Konva.Line({ points: [xC2, yBot, xR2, yTop], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(clipped);
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createUnite(x, y, label = "UNITE", color = "#d00000") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "UNITE", techizat_adi: label, isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			const r = 26,
				stroke = 2,
				portY = -60;
			g.add(new Konva.Circle({ x: 0, y: portY, radius: 5, fill: color }));
			g.add(new Konva.Line({ points: [0, portY, 0, -r], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(new Konva.Circle({ x: 0, y: 0, radius: r, stroke: color, strokeWidth: stroke }));
			const sText = new Konva.Text({ text: "S", x: 2, y: 0, fontSize: 40, fontStyle: "bold", fill: color, listening: false, scaleY: -1, rotation: 90 });
			sText.offsetX(sText.width() / 2);
			sText.offsetY(sText.height() / 2);
			g.add(sText);
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createDepolamaUnitesi(x, y, label = "DEPOLAMA_UNITESI", color = "#cc0000") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "DEPOLAMA_UNITESI", techizat_adi: label, isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			const r = 26,
				stroke = 2,
				portY = -46,
				yTop = -6,
				yBot = 6,
				topW = 34,
				botW = 20,
				vGap = 4;
			g.add(new Konva.Circle({ x: 0, y: portY, radius: 4, fill: color }));
			g.add(new Konva.Line({ points: [0, portY, 0, -r], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(new Konva.Circle({ x: 0, y: 0, radius: r, stroke: color, strokeWidth: stroke }));
			g.add(new Konva.Line({ points: [-topW / 2, yTop, topW / 2, yTop], stroke: color, strokeWidth: stroke }));
			g.add(new Konva.Line({ points: [-botW / 2, yBot, botW / 2, yBot], stroke: color, strokeWidth: stroke }));
			g.add(new Konva.Line({ points: [0, yTop, 0, -r + vGap], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(new Konva.Line({ points: [0, yBot, 0, r - vGap], stroke: color, strokeWidth: stroke, lineCap: "round" }));
			g.add(new Konva.Text({ text: "+", x: r - 14, y: yTop - 12, fontSize: 14, fontStyle: "bold", fill: color }));
			g.add(new Konva.Text({ text: "−", x: r - 14, y: yBot + 2, fontSize: 14, fontStyle: "bold", fill: color }));
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createUluslararasiBaglanti(x, y, color = "#d00000", label = "External Grid") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "ULUSLARARASI_BAGLANTI", techizat_adi: "ULUSLARARASI_BAGLANTI", isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			const port = new Konva.Circle({ x: 0, y: -36, radius: 3.5, fill: color });
			const stub = new Konva.Line({ points: [0, -36, 0, -22], stroke: color, strokeWidth: 3, lineCap: "round" });
			const pin = new Konva.Circle({ x: 0, y: -18, radius: 4, fill: color });
			const midW = 28,
				midH = 18;
			const mid = new Konva.Rect({ x: -midW / 2, y: -midH / 2, width: midW, height: midH, stroke: color, strokeWidth: 2, dash: [6, 4], cornerRadius: 3 });
			const link = new Konva.Line({ points: [0, midH / 2, 0, midH / 2 + 16], stroke: color, strokeWidth: 3, lineCap: "round" });
			const gridW = 40,
				gridH = 26,
				gridY = midH / 2 + 18;
			const extRect = new Konva.Rect({ x: -gridW / 2, y: gridY, width: gridW, height: gridH, stroke: color, strokeWidth: 2 });
			const hatch = new Konva.Group({ clip: { x: -gridW / 2, y: gridY, width: gridW, height: gridH }, listening: false });
			const step = 6;
			for (let i = -gridH; i <= gridW; i += step)
				hatch.add(new Konva.Line({ points: [-gridW / 2 + i, gridY, -gridW / 2 + i + gridH, gridY + gridH], stroke: color, strokeWidth: 1 }));
			for (let i = 0; i <= gridW + gridH; i += step)
				hatch.add(new Konva.Line({ points: [-gridW / 2 + i, gridY + gridH, -gridW / 2 + i - gridH, gridY], stroke: color, strokeWidth: 1 }));
			const lbl = new Konva.Text({ text: label, x: -60, width: 120, align: "center", y: gridY + gridH + 4, fontSize: 11, fill: color });
			g.add(port, stub, pin, mid, link, extRect, hatch, lbl);
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		function createYuk(x, y, label = "YUK", color = "#e03131") {
			const g = new Konva.Group({ x, y, draggable: true });
			selectable(g);
			g.setAttrs({ techizat_turu: "YUK", techizat_adi: label, isletme_durum: "SERVISTE", renk_kodu: color, techizat_id: newId("EQ") });
			g.add(new Konva.Line({ points: [0, -36, 0, 0], stroke: color, strokeWidth: 3 }));
			g.add(new Konva.Line({ points: [-7, 0, 7, 0, 0, 16], stroke: color, fill: null, closed: true, strokeWidth: 3 }));
			g.add(new Konva.Circle({ x: 0, y: -36, radius: 3.5, fill: color }));
			enableDurumToggle(g);
			setNodeColorBy(g);
			layer.add(g);
			return g;
		}

		// HAT (knee point eklenebilir)
		function createEditableLine(points, color = "#2f9e44") {
			const g = new Konva.Group({ draggable: true, name: "hat" });
			selectable(g);
			g.setAttr("isHat", true);
			const ln = new Konva.Line({ points, stroke: color, strokeWidth: 3, lineJoin: "miter", lineCap: "butt", hitStrokeWidth: 12 });
			g.add(ln);
			let hoverIndex = -1,
				dragIndex = -1,
				didDrag = false;
			const SNAP = 9;
			function nearestVertex(pos) {
				const p = ln.points();
				let best = -1,
					bestD = Infinity;
				for (let i = 0; i < p.length; i += 2) {
					const d = Math.hypot(pos.x - p[i], pos.y - p[i + 1]);
					if (d < bestD) {
						bestD = d;
						best = i;
					}
				}
				return bestD <= SNAP ? best : -1;
			}
			function setCursor(c) {
				const stg = g.getStage();
				if (stg) stg.container().style.cursor = c;
			}
			ln.on("mousemove", () => {
				const pos = g.getRelativePointerPosition();
				hoverIndex = nearestVertex(pos);
				setCursor(hoverIndex !== -1 ? "pointer" : "default");
			});
			ln.on("mouseout", () => setCursor("default"));
			ln.on("mousedown", () => {
				const pos = g.getRelativePointerPosition();
				dragIndex = nearestVertex(pos);
				didDrag = false;
				if (dragIndex !== -1) {
					const stage = g.getStage();
					const move = (ev) => {
						const cur = g.getRelativePointerPosition();
						let nx = cur.x,
							ny = cur.y;
						if (ev.evt.shiftKey) {
							const p = ln.points();
							const anchor = dragIndex >= 2 ? [p[dragIndex - 2], p[dragIndex - 1]] : [p[dragIndex + 2], p[dragIndex + 3]];
							const dx = nx - anchor[0],
								dy = ny - anchor[1];
							const adx = Math.abs(dx),
								ady = Math.abs(dy);
							if (adx > ady * 1.5) ny = anchor[1];
							else if (ady > adx * 1.5) nx = anchor[0];
							else {
								const sX = dx >= 0 ? 1 : -1,
									sY = dy >= 0 ? 1 : -1,
									d = Math.max(adx, ady);
								nx = anchor[0] + sX * d;
								ny = anchor[1] + sY * d;
							}
						}
						const pts = ln.points();
						pts[dragIndex] = nx;
						pts[dragIndex + 1] = ny;
						ln.points(pts);
						didDrag = true;
						layer.batchDraw();
					};
					const up = () => {
						stage.off("mousemove", move);
						stage.off("mouseup", up);
						dragIndex = -1;
					};
					stage.on("mousemove", move);
					stage.on("mouseup", up);
				}
			});
			ln.on("click", () => {
				if (didDrag || dragIndex !== -1 || hoverIndex !== -1) {
					didDrag = false;
					return;
				}
				const pos = g.getRelativePointerPosition();
				const p = ln.points();
				let insertAt = p.length,
					best = Infinity;
				for (let i = 0; i < p.length - 2; i += 2) {
					const x1 = p[i],
						y1 = p[i + 1];
					const x2 = p[i + 2],
						y2 = p[i + 3];
					const dx = x2 - x1,
						dy = y2 - y1;
					const len2 = dx * dx + dy * dy;
					if (!len2) continue;
					let t = ((pos.x - x1) * dx + (pos.y - y1) * dy) / len2;
					t = Math.max(0, Math.min(1, t));
					const px = x1 + t * dx;
					const py = y1 + t * dy;
					const d = Math.hypot(pos.x - px, pos.y - py);
					if (d < best) {
						best = d;
						insertAt = i + 2;
					}
				}
				p.splice(insertAt, 0, pos.x, pos.y);
				ln.points(p);
				layer.batchDraw();
			});
			g.on("mousedown", () => {
				tr.nodes([g]);
				tr.rotateEnabled(false);
				tr.enabledAnchors(["middle-left", "middle-right"]);
			});
			g.on("transform", () => {
				g.scaleY(1);
			});
			g.on("transformend", () => {
				const sx = g.scaleX();
				if (sx !== 1) {
					const pts = ln.points();
					for (let i = 0; i < pts.length; i += 2) pts[i] *= sx;
					ln.points(pts);
					g.scaleX(1);
					g.scaleY(1);
					layer.batchDraw();
				}
			});
			layer.add(g);
			tr.nodes([g]);
			return g;
		}


		function createIcIhtiyac(x, y, color = '#e03131') {
			const g = new Konva.Group({ x, y, draggable: true }); selectable(g);
			g.setAttrs({ techizat_turu: 'IC_IHTIYAC', techizat_adi: 'IC_IHTIYAC', isletme_durum: 'SERVISTE', renk_kodu: color, techizat_id: newId('EQ') });
			const portY = -36; g.add(new Konva.Circle({ x: 0, y: portY, radius: 3.5, fill: color }));
			g.add(new Konva.Line({ points: [0, portY, 0, -4], stroke: color, strokeWidth: 2, lineCap: 'round' }));
			g.add(new Konva.Line({ points: [-14, -4, 14, -4, 0, 18], stroke: color, strokeWidth: 2, closed: true }));
			const sText = new Konva.Text({ text: 'S', x: -6, y: -3, width: 14, align: 'center', fontSize: 15, fontStyle: 'bold', fill: color, listening: false, scaleY: -1, rotation: 90 });
			g.add(sText); enableDurumToggle(g); setNodeColorBy(g);
			layer.add(g); return g;
		}

		function routeOrth(from, to, knee) {
			if (Array.isArray(knee) && knee.length >= 2) return knee.flat();
			const dy = Math.abs(to.y - from.y);
			const midY = from.y + (dy > 40 ? Math.sign(to.y - from.y) * Math.min(60, dy / 2) : 40);
			return [from.x, from.y, from.x, midY, to.x, midY, to.x, to.y];
		}

		function rerouteConnection(conn) {
		  const A = getBarPort(conn.from), B = getBarPort(conn.to);

		  if (conn.type === "HAT") {
		    const pts = routeOrth(A, B, conn.knee);
		    const ln = conn.node.findOne("Line");
		    ln.points(pts);
		    return;
		  }

		  if (conn.type === "TRAFO") {
		    updateTrafoLinks(conn);  // <-- tek satır yeterli
		    return;
		  }

		  // ... diğer türler (ANAHTAR, SERI_KAPASITOR) ortada kalabilir
		  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
		  conn.node.position(mid);
		}


		// Araç/yerleştirme durumu

		let activeTool = null;
		let placingNode = null; // toolbar’dan seçince mouse’u takip eden önizleme obje
		let linkingEquip = null; // sahneye konmuş ama bağlanmamış node
		let pendingLinks = 0; // gereken bar sayısı
		let firstBarId = null; // iki baralıda ilk bağlanan baranın id’si
		let currentPortSide = null; // 'left'|'right'|'top'|'bottom'|'single'

		// Üst kısımda:
		let currentBaraType = 'ANABARA';
		let pendingBaraType = null;

		let baraGhost = null;

		function makeBaraGhost(tip) {
			if (baraGhost) baraGhost.destroy();
			const g = new Konva.Group({ listening: false, draggable: false, opacity: 0.6, name: '__ghost_bara__' });
			const color = '#cc0000';
			tip = (tip || 'JUNCTION').toUpperCase();
			if (tip === 'ANABARA') {
				g.add(new Konva.Line({ points: [-70, 0, 70, 0], stroke: color, strokeWidth: 5, lineCap: 'round' }));
			} else if (tip === 'URETIM_BARASI') {
				g.add(new Konva.Line({ points: [-40, 0, 40, 0], stroke: color, strokeWidth: 5, lineCap: 'round' }));
			} else {
				g.add(new Konva.Circle({ radius: 7, fill: color }));
			}
			layer.add(g);
			baraGhost = g;
			layer.batchDraw();
		}
		function clearBaraGhost() {
			if (baraGhost) { baraGhost.destroy(); baraGhost = null; layer.batchDraw(); }
		}

		const btnBara = document.getElementById('btnBara');
		const baraMenu = document.getElementById('baraMenu');

		// bara menüydü ama şu an göstermiyorum
		if (btnBara && baraMenu) {
			btnBara.addEventListener('click', (e) => {
				e.stopPropagation();
				// aracı aktif et
				activeTool = 'BARA';
				pendingBaraType = null;
				stage.container().style.cursor = 'crosshair';

				const r = btnBara.getBoundingClientRect();
				// HEMEN YANINA: sağa 6px, dikey hizalı
				baraMenu.style.left = (r.right + window.scrollX + 6) + 'px';
				baraMenu.style.top = (r.top + window.scrollY) + 'px';
				baraMenu.style.display = 'block';
			});

			// Menü seçenekleri (HTMLde data-baratype var)
			baraMenu.querySelectorAll('.opt').forEach(opt => {
				opt.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();

					pendingBaraType = opt.dataset.baratype || 'ANABARA';
					currentBaraType = pendingBaraType;   // bir dahaki seçim için hatırla

					baraMenu.style.display = 'none';

					// >>> ÖNEMLİ: BARA modunu aktif et
					activeTool = 'BARA';
					stage.container().style.cursor = 'crosshair';

					// Ghost kullanıyorsan:
					if (typeof makeBaraGhost === 'function') {
						makeBaraGhost(currentBaraType);
					}

					// klavye/ESC vs. için odağı tekrar sahneye ver
					stage.container().focus();
				});
			});


			// Menü dışına tıklayınca kapat
			document.addEventListener('click', (e) => {
				if (!baraMenu.contains(e.target) && e.target !== btnBara) {
					baraMenu.style.display = 'none';
				}
			});
		}


		let rubberLine = null; // Konva.Line (kesikli)
		function startRubberAt(pt, color = "#555") {
			if (rubberLine) rubberLine.destroy();
			rubberLine = new Konva.Line({ points: [pt.x, pt.y, pt.x, pt.y], stroke: color, strokeWidth: 2, dash: [8, 6], listening: false, name: "__ghost__" });
			layer.add(rubberLine);
			layer.batchDraw();
		}
		function updateRubberTo(pt) {
			if (!rubberLine) return;
			const p = rubberLine.points();
			p[2] = pt.x;
			p[3] = pt.y;
			rubberLine.points(p);
			layer.batchDraw();
		}
		function cancelRubber() {
			if (rubberLine) {
				rubberLine.destroy();
				rubberLine = null;
			}
			currentPortSide = null;
			layer.batchDraw();
		}

		function finishTool() {
			cancelRubber();
			linkingEquip = null;
			pendingLinks = 0;
			firstBarId = null;
			placingNode = null;
			activeTool = null;
			tr.nodes([]);
			stage.container().style.cursor = "default";
			if (typeof clearBaraGhost === "function") clearBaraGhost();  // <— eklendi
			layer.batchDraw();
		}


		const singleBarTools = new Set(["UNITE", "DEPOLAMA_UNITESI", "LISANSSIZ_SANTRAL", "ULUSLARARASI_BAGLANTI", "YUK", "IC_IHTIYAC"]);
		const twoBarTools = new Set(["ANAHTAR", "TRAFO", "SERI_KAPASITOR"]);

		function beginPlacement(tool) {
			activeTool = tool;
			placingNode = null;
			let make = null;
			const map = {
				UNITE: () => createUnite(0, 0, "UNITE", "#d00000"),
				DEPOLAMA_UNITESI: () => createDepolamaUnitesi(0, 0, "DEPOLAMA_UNITESI", "#cc0000"),
				LISANSSIZ_SANTRAL: () => createLisanssizSantral(0, 0, "#000"),
				ULUSLARARASI_BAGLANTI: () => createUluslararasiBaglanti(0, 0, "#d00000", "External Grid"),
				YUK: () => createYuk(0, 0, "YUK", "#e03131"),
				IC_IHTIYAC: () => createIcIhtiyac(0, 0, "#e03131"),
				ANAHTAR: () => createSwitchSymbol(0, 0, "#e03131"),
				TRAFO: () => createTrafoSymbol(0, 0, "#f08c00"),
				SERI_KAPASITOR: () => createSeriKapasitorSymbol(0, 0, "#4a4642"),
			};
			make = map[tool];
			if (!make) return;
			placingNode = make();
			placingNode.opacity(0.65);
			placingNode.draggable(false);
			placingNode.listening(false);
			tr.nodes([]);
			stage.container().style.cursor = "crosshair";
		}

		function previewColorFor(tool) {
			if (tool === "HAT") return "#2f9e44";
			if (tool === "ANAHTAR") return "#e03131";
			if (tool === "SERI_KAPASITOR") return "#4a4642";
			if (tool === "TRAFO") return "#f08c00";
			return "#555";
		}

		// Stage mousemove: önizleme ve lastik çizgi + bar mıknatısı
		stage.on("mousemove", () => {
			const pos = stage.getPointerPosition();
			if (!pos) return;

			if (activeTool === 'BARA' && (pendingBaraType || currentBaraType)) {
				if (!baraGhost) makeBaraGhost(pendingBaraType || currentBaraType);
				const pos = stage.getRelativePointerPosition();
				if (pos) baraGhost.position({ x: snap(pos.x), y: snap(pos.y) });
			}
			const sx = snap(pos.x),
				sy = snap(pos.y);
			if (placingNode) placingNode.position({ x: sx, y: sy });

			if (rubberLine) {
				const hov = hoveredBarAt({ x: sx, y: sy });
				const end = hov ? { x: hov.attachPoint.x, y: hov.attachPoint.y } : { x: sx, y: sy };
				updateRubberTo(end);
			}
			layer.batchDraw();
		});

		function flashSelect(node) {
			try {
				const orig = node.opacity();
				node.opacity(0.7);
				layer.batchDraw();
				setTimeout(() => {
					node.opacity(orig);
					layer.batchDraw();
				}, 120);
			} catch (_) { }
		}

		// Tüm placement & bağlama tek handler
		stage.off('.place');
		stage.on('click.place', (evt) => {
			const pos = stage.getRelativePointerPosition();
			if (!pos) return;
			const sx = snap(pos.x), sy = snap(pos.y);

			// Yakındaki barayı tespit et (hat/bağlama için lazım)
			let clickedBarId = null;
			const hov = hoveredBarAt && hoveredBarAt({ x: sx, y: sy });
			if (hov) clickedBarId = hov.id || null;

			// -----------------------------
			// 1) BARA: sadece bırak
			// -----------------------------
			if (activeTool === 'BARA') {
				if (findBaraGroupFromTarget(evt.target)) return;

				const tip = (pendingBaraType || currentBaraType || 'ANABARA');
				const g = createBara(sx, sy, tip, null);

				if (baraMenu) baraMenu.style.display = 'none';
				finishTool();                 // <— tek seferlik
				tr.nodes([g]);                // istersen seçili kalsın
				layer.batchDraw();
				return;
			}


			// -----------------------------
			// 2) HAT özel akış
			// -----------------------------
			if (activeTool === 'HAT') {
				if (!firstBarId && clickedBarId) {
					firstBarId = clickedBarId;
					const g = bars.get(firstBarId)?.node; if (g) flashSelect(g);
					startRubberAt({ x: sx, y: sy }, previewColorFor('HAT'));
					return;
				}
				if (firstBarId && clickedBarId) {
					const node = connectTwoBar('HAT', firstBarId, clickedBarId, {});
					if (node) tr.nodes([node]);
					firstBarId = null;
					cancelRubber();
					activeTool = null;
					layer.batchDraw();
				}
				return;
			}

			// -----------------------------
			// 3) Diğer araçlar: placing ,sabitle
			// -----------------------------
			if (placingNode) {
				// önizleme vardı → sabitle
				placingNode.opacity(1);
				placingNode.listening(true);
				placingNode.position({ x: sx, y: sy });
				tr.nodes([placingNode]);
				linkingEquip = placingNode;
				placingNode = null;

				// tek baralı
				if (singleBarTools.has(activeTool)) {
					if (clickedBarId) {
						const ap = getBarAttachPoint(clickedBarId, sx);
						attachments.push({ type: activeTool, barId: clickedBarId, node: linkingEquip, offset: 60, relX: ap.relX });
						updateBarLinks(clickedBarId);
						const g = bars.get(clickedBarId)?.node; if (g) flashSelect(g);
						cancelRubber();              // <<-- EKLE: lastiği kapat
						finishTool();
					} else {
						// Bar seçilmediyse: ekipmanı sabitleyip portundan lastiği başlat
						tr.nodes([]);                // <<-- EKLE: transformer’ı gizle ki çizgi örtülmesin
						const start = getPortAbs(linkingEquip, 'single');
						startRubberAt(start, previewColorFor(activeTool));

						// <<-- EKLE: ilk frame’i hemen güncelle (mouse hareketini bekleme)
						const cur = stage.getRelativePointerPosition() || stage.getPointerPosition();
						if (cur) {
							const ex = snap(cur.x), ey = snap(cur.y);
							const hov = hoveredBarAt({ x: ex, y: ey });
							updateRubberTo(hov ? hov.attachPoint : { x: ex, y: ey });
						}

						// <<-- EKLE: çizgiyi en üste al (görsel garanti)
						if (rubberLine) rubberLine.moveToTop();
						layer.batchDraw();

						pendingLinks = 1; // 1 bara bekleniyor
					}
					return;
				}


				// iki baralı
				if (twoBarTools.has(activeTool)) {
					// kullanıcı bar üstüne tıkladıysa bunu ilk bar kabul et
					if (clickedBarId) {
						firstBarId = clickedBarId;
						const g = bars.get(firstBarId)?.node; if (g) flashSelect(g);
						const side = (activeTool === 'SERI_KAPASITOR') ? 'bottom' : 'right';
						startRubberAt(getPortAbs(linkingEquip, side), previewColorFor(activeTool));
						pendingLinks = 1;
					} else {
						// henüz bar yok → uygun porttan lastiği başlat, 2 bar beklenecek
						const startSide = (activeTool === 'SERI_KAPASITOR') ? 'top' : 'left';
						startRubberAt(getPortAbs(linkingEquip, startSide), previewColorFor(activeTool));
						pendingLinks = 2;
					}
					return;
				}

				return;
			}

			// -----------------------------
			// 4) Bağlama fazı (placingNode yokken)
			// -----------------------------
			if (linkingEquip) {
				// tek baralı: bar seçilince bağla ve bitir
				if (singleBarTools.has(activeTool) && clickedBarId) {
					const ap = getBarAttachPoint(clickedBarId, sx);
					attachments.push({ type: activeTool, barId: clickedBarId, node: linkingEquip, offset: 60, relX: ap.relX });
					updateBarLinks(clickedBarId);
					const g = bars.get(clickedBarId)?.node; if (g) flashSelect(g);
					cancelRubber();
					finishTool();
					return;
				}

				// iki baralı: birinci yoksa ilk, varsa ikinci bara ve bitir
				if (twoBarTools.has(activeTool) && clickedBarId) {
					if (!firstBarId) {
						firstBarId = clickedBarId;
						const g = bars.get(firstBarId)?.node; if (g) flashSelect(g);
						const side = (activeTool === 'SERI_KAPASITOR') ? 'bottom' : 'right';
						startRubberAt(getPortAbs(linkingEquip, side), previewColorFor(activeTool));
						pendingLinks = 1;
					} else {
						const node = connectTwoBar(activeTool, firstBarId, clickedBarId, {});
						if (node) tr.nodes([node]);
						finishTool();
					}
					return;
				}
			}
		});


		// ======================
		// Bağlantı oluşturucular
		// ======================
		function connectTwoBar(turu, fromBarId, toBarId, options = {}) {
			const A = getBarPort(fromBarId),
				B = getBarPort(toBarId);
			let node = null;
			if (turu === "HAT") {
				const pts = routeOrth(A, B, options.knee);
				node = createEditableLine(pts, options.renk_kodu || "#2f9e44");
			} else if (turu === "TRAFO") {
				node = createTrafoSymbol((A.x + B.x) / 2, (A.y + B.y) / 2, options.renk_kodu || "#f08c00");
			} else if (turu === "ANAHTAR") {
				node = createSwitchSymbol((A.x + B.x) / 2, (A.y + B.y) / 2, options.renk_kodu || "#e03131");
			} else if (turu === "SERI_KAPASITOR") {
				node = createSeriKapasitorSymbol((A.x + B.x) / 2, (A.y + B.y) / 2, options.renk_kodu || "#4a4642");
			}
			const conn = { type: turu, from: fromBarId, to: toBarId, node, knee: options.knee, baslangic_renk_kodu: options.baslangic_renk_kodu, bitis_renk_kodu: options.bitis_renk_kodu };
			connections.push(conn);
			rerouteConnection(conn);

			try {
				if (typeof linkingEquip !== "undefined" && linkingEquip && linkingEquip !== node) {
					linkingEquip.destroy();   // sahneden kaldır
				}
				// state’i de sıfırla
				if (typeof linkingEquip !== "undefined") linkingEquip = null;
			} catch (_) { }
			return node;
		}

		function attachSingleBarEquip(turu, barId, makeNode, offset = 60) {
			const p = getBarPort(barId);
			const node = makeNode(p.x, p.y + offset);
			attachments.push({ type: turu, barId, node, offset, relX: 0 });
			updateBarLinks(barId);
			return node;
		}

		// ======================
		// Serbest Metin(ama şu an bu da gösterilmiyor)
		// ======================
		function createFreeText(x, y, text = "Yeni Metin") {
			const t = new Konva.Text({ x, y, text, fontSize: 12, fill: "#000", draggable: true });
			selectable(t);
			t.setAttrs({ techizat_turu: "METIN", techizat_adi: "METIN", techizat_id: newId("TXT") });
			t.on("click", () => {
				if (t.text() === "Yeni Metin") {
					t.text("");
					layer.draw();
				}
				const stageBox = stage.container().getBoundingClientRect();
				const abs = t.absolutePosition();
				const input = document.createElement("input");
				input.type = "text";
				input.value = t.text();
				document.body.appendChild(input);
				input.style.position = "absolute";
				input.style.top = stageBox.top + abs.y + "px";
				input.style.left = stageBox.left + abs.x + "px";
				input.style.width = "150px";
				input.style.fontSize = t.fontSize() + "px";
				input.focus();
				input.addEventListener("keydown", (e) => {
					// başka handler'lara gitmesin, form submit olmasın
					e.stopPropagation();

					if (e.key === "Enter") {
						e.preventDefault();
						t.text(input.value || "");
						document.body.removeChild(input);
						layer.batchDraw();

						// sahneyi tekrar odağa al
						stage.container().focus();
						return;
					}

					if (e.key === "Escape") {
						e.preventDefault();
						// değişiklikleri iptal et (t.text dokunmuyoruz), input'u kapat
						if (document.body.contains(input)) document.body.removeChild(input);
						layer.batchDraw();

						// araç modundan çık + ghost'u temizle (varsa)
						activeTool = null;
						stage.container().style.cursor = "default";
						if (typeof clearBaraGhost === "function") clearBaraGhost();

						// sahneyi tekrar odağa al
						stage.container().focus();
						finishTool();
						if (typeof clearBaraGhost === 'function') clearBaraGhost();

						return;
					}
				});

				input.addEventListener("blur", () => {
					t.text(input.value || "");
					document.body.removeChild(input);
					layer.batchDraw();
				});
			});
			layer.add(t);
			tr.nodes([t]);
			return t;
		}

		// ======================
		// Snapshot / Rebuild
		// ======================
		function snapshot() {
			const items = [];
			bars.forEach(({ node }) => {
				items.push({ techizat_turu: "BARA", techizat_adi: node.getAttr("techizat_adi"), techizat_id: node.getAttr("techizat_id"), x: node.x(), y: node.y() });
			});
			attachments.forEach((a) => {
				items.push({ techizat_turu: a.type, bara_id: a.barId, x: a.node.x(), y: a.node.y(), offset: a.offset, relX: a.relX || 0, renk_kodu: a.node.getAttr("renk_kodu") });
			});
			connections.forEach((c) => {
				const base = { techizat_turu: c.type, baslangic_bara_id: c.from, bitis_bara_id: c.to };
				if (c.type === "HAT") {
					const ln = c.node.findOne("Line");
					items.push({ ...base, points: ln.points() });
				} else items.push(base);
			});
			layer.find("Text").forEach((n) => {
				if (n.getAttr("techizat_turu") === "METIN") {
					items.push({ techizat_turu: "METIN", techizat_id: n.getAttr("techizat_id") || newId("TXT"), text: n.text(), x: n.x(), y: n.y(), fontSize: n.fontSize(), renk_kodu: n.fill() || "#000" });
				}
			});
			return { version: 2, stage: { width: stage.width(), height: stage.height() }, items };
		}
		
		function stripBaraId(id){
		  const m = String(id).match(/^BARA_(\d+)$/);
		  return m ? Number(m[1]) : id;
		}

		// Canvas -> Backend DTO
		function buildBeanFromCanvas(){
		  const list = [];

		  // Baralar
		  bars.forEach(({node, tur_id}, bara_id) => {
		    list.push({
		      techizat_turu: "BARA",
		      techizat_id: stripBaraId(bara_id),
		      bar_tipi: tur_id,
		      x: node.x(),
		      y: node.y()
		    });
		  });

		  // Tek-baralı ekipmanlar
		  attachments.forEach(a => {
		    list.push({
		      techizat_turu: a.type,
		      techizat_id: a.node.getAttr("techizat_id"),
		      bara_id: stripBaraId(a.barId),
		      relX: a.relX || 0,
		      offset: a.offset ?? 60,
		      renk_kodu: a.node.getAttr("renk_kodu"),
		      techizat_adi: a.node.getAttr("techizat_adi")
		    });
		  });

		  // İki-baralı ekipmanlar & hatlar
		  connections.forEach(c => {
		    const base = {
		      techizat_turu: c.type,
		      techizat_id: c.node?.getAttr?.("techizat_id"),
		      baslangic_bara_id: stripBaraId(c.from),
		      bitis_bara_id: stripBaraId(c.to)
		    };
		    if (c.type === "HAT") {
		      const ln = c.node.findOne("Line");
		      base.points = ln.points();
		    }
		    list.push(base);
		  });

		  // Serbest metinler
		  layer.find("Text").forEach(n => {
		    if (n.getAttr("techizat_turu") === "METIN") {
		      list.push({
		        techizat_turu: "METIN",
		        techizat_id: n.getAttr("techizat_id"),
		        text: n.text(),
		        x: n.x(), y: n.y(),
		        fontSize: n.fontSize(),
		        renk_kodu: n.fill() || "#000"
		      });
		    }
		  });

		  return {
		    cizimYapisi: { genislik: stage.width(), uzunluk: stage.height() },
		    techizat_listesi: list
		  };
		}

		// Kaydet butonu
		bindBtn("btnSave", async () => {
		  const dto = buildBeanFromCanvas();

		  try {
		    await fetch("/api/sld/kaydet", {
		      method: "POST",
		      headers: { "Content-Type":"application/json" },
		      body: JSON.stringify(dto)
		    });
		    alert("Kaydedildi.");
		  } catch (err) {
		    console.error("Sunucuya kaydolamadı, yerelde saklanıyor:", err);
		    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
		    alert("Sunucu hatası: Yerel kopya alındı.");
		  }
		});

		
		function clearCanvas() {
			tr.nodes([]);
			layer.getChildren().forEach((n) => {
				if (n !== tr) n.destroy();
			});
			bars.clear();
			attachments.length = 0;
			connections.length = 0;
			layer.draw();
			drawGrid();
		}

		function rebuild(data) {
			if (!data || !Array.isArray(data.items)) return;
			clearCanvas();
			data.items
				.filter((i) => i.techizat_turu === "BARA")
				.forEach((it) => {
					createBara(it.x, it.y, it.techizat_adi || "JUNCTION", it.techizat_id);
				});
			data.items
				.filter((i) => ["LISANSSIZ_SANTRAL", "UNITE", "DEPOLAMA_UNITESI", "ULUSLARARASI_BAGLANTI", "YUK", "IC_IHTIYAC"].includes(i.techizat_turu))
				.forEach((it) => {
					const maker = {
						LISANSSIZ_SANTRAL: createLisanssizSantral,
						UNITE: (x, y) => createUnite(x, y, it.techizat_adi || "UNITE", it.renk_kodu || "#d00000"),
						DEPOLAMA_UNITESI: (x, y) => createDepolamaUnitesi(x, y, it.techizat_adi || "DEPOLAMA_UNITESI", it.renk_kodu || "#cc0000"),
						ULUSLARARASI_BAGLANTI: (x, y) => createUluslararasiBaglanti(x, y, it.renk_kodu || "#d00000"),
						YUK: (x, y) => createYuk(x, y, it.techizat_adi || "YUK"),
						IC_IHTIYAC: (x, y) => createIcIhtiyac(x, y, it.renk_kodu || "#e03131"),
					}[it.techizat_turu];
					const node = maker ? maker(0, 0) : null;
					if (!node) return;
					const off = it.offset ?? 60;
					attachments.push({ type: it.techizat_turu, barId: it.bara_id, node, offset: off, relX: it.relX || 0 });
					updateBarLinks(it.bara_id);
				});
			data.items
				.filter((i) => i.baslangic_bara_id && i.bitis_bara_id)
				.forEach((it) => {
					if (it.techizat_turu === "HAT") connectTwoBar("HAT", it.baslangic_bara_id, it.bitis_bara_id, { knee: it.points });
					else if (it.techizat_turu === "TRAFO") connectTwoBar("TRAFO", it.baslangic_bara_id, it.bitis_bara_id, {});
					else if (it.techizat_turu === "ANAHTAR") connectTwoBar("ANAHTAR", it.baslangic_bara_id, it.bitis_bara_id, {});
					else if (it.techizat_turu === "SERI_KAPASITOR") connectTwoBar("SERI_KAPASITOR", it.baslangic_bara_id, it.bitis_bara_id, {});
				});
			layer.draw();
		}

		// ======================
		// Toolbar bağlama 
		// ======================
		function bindBtn(id, onClick) {
			const el = document.getElementById(id);
			if (!el) return;
			el.addEventListener("click", (e) => {
				e.preventDefault();
				onClick(e);
			});
		}

		[
			["btnUnite", () => beginPlacement("UNITE")],
			["btnDepolama", () => beginPlacement("DEPOLAMA_UNITESI")],
			["btnSantral", () => beginPlacement("LISANSSIZ_SANTRAL")],
			["btnBaglanti", () => beginPlacement("ULUSLARARASI_BAGLANTI")],
			["btnYuk", () => beginPlacement("YUK")],
			["btnIcIhtiyac", () => beginPlacement("IC_IHTIYAC")],
			["btnSwitch", () => beginPlacement("ANAHTAR")],
			["btnTrafo", () => beginPlacement("TRAFO")],
			["btnSeriKapasitor", () => beginPlacement("SERI_KAPASITOR")],
			["btnHat", () => (activeTool = "HAT")],
			["btnText", () => createFreeText(80, 80, "Yeni Metin")],
			["btnNew", () => confirm("Temizlensin mi?") && clearCanvas()],
			["btnSave", () => localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()))],
			["btnLoad", () => {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw) rebuild(JSON.parse(raw));
			}],
			["btnExport", () => {
				const data = snapshot();
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "sld-diagram.json";
				document.body.appendChild(a);
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
			}],
			["btnImport", () => document.getElementById("fileInput")?.click()],
		].forEach(([id, fn]) => bindBtn(id, fn));

		// File import (varsa)
		const fileInput = document.getElementById("fileInput");
		if (fileInput) {
			fileInput.addEventListener("change", (e) => {
				const f = e.target.files?.[0];
				if (!f) return;
				const reader = new FileReader();
				reader.onload = (ev) => {
					try {
						const data = JSON.parse(ev.target.result);
						if (Array.isArray(data.items)) rebuild(data);
					} catch (err) {
						console.error("JSON import hatası", err);
					}
				};
				reader.readAsText(f);
				e.target.value = "";
			});
		}


		// ======================
		// BEAN TABANLI DİNAMİK TOOLBAR
		// ======================
		let __beanCatalog = null;
		let pendingBeanBar = null; // {techizat_id, bar_tipi, label}
		function normalizeBaraId(rawId) {
			// backend '1' -> our canvas id 'BARA_1'
			return String(rawId).startsWith("BARA_") ? String(rawId) : ("BARA_" + rawId);
		}

		function makeToolbarSection(title) {
			const box = document.createElement('div');
			box.className = 'tool-section';
			box.style.padding = '8px';
			box.style.borderBottom = '1px dashed #ddd';

			const h = document.createElement('div');
			h.textContent = title;
			h.style.fontWeight = '600';
			h.style.marginBottom = '6px';
			box.appendChild(h);

			const ul = document.createElement('ul');
			ul.style.listStyle = 'none';
			ul.style.margin = '0';
			ul.style.padding = '0';
			box.appendChild(ul);
			return { box, ul };
		}

		function pushToolbarItem(ul, label, onClick, meta){
		  const li = document.createElement('li');
		  li.style.margin = '4px 0';
		  if (meta) {
		    if (meta.type) li.dataset.type = meta.type;
		    if (meta.id != null) li.dataset.id = String(meta.id);
		  }
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.textContent = label;
			Object.assign(btn.style, {
				width: '100%',
				padding: '8px',
				border: '1px solid #ccc',
				borderRadius: '8px',
				background: '#fafafa',
				cursor: 'pointer',
				textAlign: 'left'
			});
			btn.onmouseenter = () => btn.style.background = '#f0f0f0';
			btn.onmouseleave = () => btn.style.background = '#fafafa';
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				onClick(() => { li.remove(); }); // remove callback
			});
			li.appendChild(btn);
			ul.appendChild(li);
		}

		function startBeanBarPlacement(item, removeCb) {
			pendingBeanBar = item;
			activeTool = 'BARA_BEAN';
			stage.container().style.cursor = 'crosshair';
			makeBaraGhost(item.bar_tipi || 'ANABARA');

			const stageClickOnce = (e) => {
				const pos = stage.getRelativePointerPosition();
				if (!pos) { return; }
				const sx = snap(pos.x), sy = snap(pos.y);
				const newId = 'BARA_' + item.techizat_id;
				const g = createBara(sx, sy, (item.bar_tipi || 'ANABARA'), newId);
				finishTool();
				removeCb && removeCb();
				stage.off('click.placeBeanBar', stageClickOnce);
				tr.nodes([g]);
				layer.batchDraw();
			};
			// attach once
			stage.on('click.placeBeanBar', stageClickOnce);
		}

		function placeBeanTrafo(item, removeCb) {
			const a = 'BARA_' + item.baslangic_bara_id;
			const b = 'BARA_' + item.bitis_bara_id;
			if (!bars.has(a) || !bars.has(b)) {
				alert(`Önce ${!bars.has(a) ? ('Bara ' + item.baslangic_bara_id) : ''} ${(!bars.has(a) && !bars.has(b)) ? 've' : ''} ${!bars.has(b) ? ('Bara ' + item.bitis_bara_id) : ''} yerleştirin.`);
				return;
			}
			const node = connectTwoBar('TRAFO', a, b, {});
			if (node) {
				tr.nodes([node]);
				removeCb && removeCb();
				layer.batchDraw();
			}
		}
		
		// İKİ BARALI (ANAHTAR, TRAFO, SERI_KAPASITOR, HAT)
		function placeBeanTwoBar(item, tur) {
		  const a = 'BARA_' + item.baslangic_bara_id;
		  const b = 'BARA_' + item.bitis_bara_id;
		  if (!bars.has(a) || !bars.has(b)) {
		    alert(`Önce ${!bars.has(a) ? `Bara ${item.baslangic_bara_id}` : ''} ${(!bars.has(a)&&!bars.has(b))?'ve':''} ${!bars.has(b) ? `Bara ${item.bitis_bara_id}` : ''} yerleştirin.`);
			return false;                   // <<< önemli: silme yok
		  }
		  const node = connectTwoBar(tur, a, b, {});
		  if (node) { tr.nodes([node]); layer.batchDraw(); return true; }
		  return false;
		}

		// TEK BARALI (UNITE, DEPOLAMA_UNITESI, LISANSSIZ_SANTRAL, ULUSLARARASI_BAGLANTI, YUK, IC_IHTIYAC)
		function placeBeanSingle(item) {
		  const barId = 'BARA_' + (item.bara_id ?? item.baslangic_bara_id);
		  if (!bars.has(barId)) {
		    alert(`Önce Bara ${item.bara_id ?? item.baslangic_bara_id} yerleştirin.`);
		    return false;
		  }
		  const makers = {
		    UNITE: (x,y)=> createUnite(x,y,item.techizat_adi || 'UNITE', '#d00000'),
		    DEPOLAMA_UNITESI: (x,y)=> createDepolamaUnitesi(x,y,item.techizat_adi || 'DEPOLAMA_UNITESI', '#cc0000'),
		    LISANSSIZ_SANTRAL: (x,y)=> createLisanssizSantral(x,y, '#000'),
		    ULUSLARARASI_BAGLANTI: (x,y)=> createUluslararasiBaglanti(x,y, '#d00000', 'External Grid'),
		    YUK: (x,y)=> createYuk(x,y, item.techizat_adi || 'YUK', '#e03131'),
		    IC_IHTIYAC: (x,y)=> createIcIhtiyac(x,y, '#e03131'),
		  };
		  const make = makers[(item.techizat_turu || '').toUpperCase()];
		  if (!make) return;
		  attachSingleBarEquip((item.techizat_turu || '').toUpperCase(), barId, (x,y)=> make(x,y), 60);
		  layer.batchDraw();
		  return true;
		}


		function buildToolbarFromBean(data){
		  __beanCatalog = data;
		  if (!palette) return;

		  palette.innerHTML = '';
		  const title = document.createElement('div');
		  title.textContent = 'Katalog (SemaCizimBean)';
		  Object.assign(title.style, { fontWeight:'700', padding:'10px', borderBottom:'1px solid #ddd' });
		  palette.appendChild(title);

		  const list = Array.isArray(data.techizat_listesi) ? data.techizat_listesi : [];

		  // ---------- Baralar ----------
		  const barsBean = list.filter(x => (x.techizat_turu || '').toUpperCase() === 'BARA');
		  if (barsBean.length){
		    const {box, ul} = makeToolbarSection('Baralar');
		    barsBean.forEach((it, idx) => {
		      const lbl = `Bara ${idx + 1}`;
		      pushToolbarItem(ul, lbl, (done)=> startBeanBarPlacement(it, done),
		                      { type:'BARA', id: it.techizat_id });
		    });
		    palette.appendChild(box);
		  }

		  // Ortak yerleştirici
		  const place2 = (it, type) => placeBeanTwoBar(it, type);

		  // ---------- Trafolar ----------
		  const trafos = list.filter(x => (x.techizat_turu || '').toUpperCase() === 'TRAFO');
		  if (trafos.length){
		    const {box, ul} = makeToolbarSection('Trafolar');
		    trafos.forEach((it, idx) => {
		      const lbl = `Trafo ${idx + 1}`;
			  pushToolbarItem(ul, lbl, (done)=>{ if (place2(it, 'TRAFO')) done(); }, { type:'TRAFO', id: it.techizat_id });

		    });
		    palette.appendChild(box);
		  }

		  // ---------- Anahtarlar ----------
		  const anahtarlar = list.filter(x => (x.techizat_turu || '').toUpperCase() === 'ANAHTAR');
		  if (anahtarlar.length){
		    const {box, ul} = makeToolbarSection('Anahtarlar');
		    anahtarlar.forEach((it, idx) => {
		      const lbl = `Anahtar ${idx + 1}`;
			  pushToolbarItem(ul, lbl, (done)=>{ if (place2(it, 'ANAHTAR')) done(); }, { type:'ANAHTAR', id: it.techizat_id });

		    });
		    palette.appendChild(box);
		  }

		  // ---------- Seri Kapasitörler ----------
		  const seriKaps = list.filter(x => (x.techizat_turu || '').toUpperCase() === 'SERI_KAPASITOR');
		  if (seriKaps.length){
		    const {box, ul} = makeToolbarSection('Seri Kapasitörler');
		    seriKaps.forEach((it, idx) => {
		      const lbl = `Seri Kapasitör ${idx + 1}`;
			  pushToolbarItem(ul, lbl, (done)=>{ if (place2(it, 'SERI_KAPASITOR')) done(); }, { type:'SERI_KAPASITOR', id: it.techizat_id });

		    });
		    palette.appendChild(box);
		  }

		  // ---------- Hatlar ----------
		  const hatlar = list.filter(x => (x.techizat_turu || '').toUpperCase() === 'HAT');
		  if (hatlar.length){
		    const {box, ul} = makeToolbarSection('Hatlar');
		    hatlar.forEach((it, idx) => {
		      const lbl = `Hat ${idx + 1}`;
			  pushToolbarItem(ul, lbl, (done)=>{ if (place2(it, 'HAT')) done(); }, { type:'HAT', id: it.techizat_id });

		    });
		    palette.appendChild(box);
		  }

		  // ---------- Tek-Baralı Ekipmanlar ----------
		  const singleList = list.filter(x => ['UNITE','DEPOLAMA_UNITESI','LISANSSIZ_SANTRAL','ULUSLARARASI_BAGLANTI','YUK','IC_IHTIYAC']
		                         .includes((x.techizat_turu||'').toUpperCase()));
		  if (singleList.length){
		    const {box, ul} = makeToolbarSection('Tek-Baralı Ekipmanlar');
		    const displayName = {
		      UNITE: 'Ünite', DEPOLAMA_UNITESI: 'Depolama', LISANSSIZ_SANTRAL: 'Lisanssız',
		      ULUSLARARASI_BAGLANTI: 'Uluslararası Bağlantı', YUK: 'Yük', IC_IHTIYAC: 'İç İhtiyaç',
		    };
		    const typeCounters = {};
		    singleList.forEach(it => {
		      const t = (it.techizat_turu || '').toUpperCase();
		      typeCounters[t] = (typeCounters[t] || 0) + 1;
		      const lbl = `${displayName[t] || t} ${typeCounters[t]}`;
			  pushToolbarItem(ul, lbl, (done)=>{ if (placeBeanSingle(it)) done(); }, { type: t, id: it.techizat_id });

		    });
		    palette.appendChild(box);
		  }

		  // Eğer hiçbiri yoksa
		  if (!barsBean.length && !trafos.length && !anahtarlar.length && !seriKaps.length && !hatlar.length && !singleList.length){
		    const empty = document.createElement('div');
		    empty.textContent = 'Katalog boş.';
		    empty.style.padding = '10px';
		    palette.appendChild(empty);
		  }
		}


		// Kullanılmış baraları canvasa göre paletten düş
		function pruneToolbarByCanvas() {
		  if (!palette) return;
		  const usedBars = new Set();
		  bars.forEach((_, key) => {
		    const m = String(key).match(/^BARA_(\d+)$/);
		    if (m) usedBars.add(m[1]);
		  });
		  palette.querySelectorAll('li[data-type="BARA"]').forEach(li => {
		    const id = li.dataset.id;
		    if (usedBars.has(id)) li.remove();
		  });
		}


		// Açılış: önce server JSON var mı, ona göre toolbar kur; ayrıca snapshot varsa sahneyi yükle
		try {
			const el = document.getElementById('cizim-data');
			const rawLocal = localStorage.getItem(STORAGE_KEY);

			const AUTO_LOAD_SNAPSHOT = false; // <-- İSTEDİĞİN GİBİ: İlk açılışta boş istiyorsan false yap

			if (el && el.textContent.trim()) {
				const obj = JSON.parse(el.textContent);
				buildToolbarFromBean(obj);

				if (obj.items && Array.isArray(obj.items)) {
					rebuild(obj);
					pruneToolbarByCanvas();

					pruneToolbarByCanvas();             // <— 2. adımda ekleyeceğimiz fonksiyon
				} else if (rawLocal && AUTO_LOAD_SNAPSHOT) {
					rebuild(JSON.parse(rawLocal));
					pruneToolbarByCanvas();
				}
			} else if (rawLocal && AUTO_LOAD_SNAPSHOT) {
				rebuild(JSON.parse(rawLocal));
				pruneToolbarByCanvas();
			}
		} catch (e) {
			console.error('Başlatma hatası:', e);
		}


	})();
});
