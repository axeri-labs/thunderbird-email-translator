1. Telepítés fejlesztői módban

Thunderbirdben:

about:debugging → "This Thunderbird" → "Load Temporary Add-on..."
Válaszd ki a manifest.json fájlt a projektkönyvtárból
Az extension betöltődik, de Thunderbird újraindításkor elvész (fejlesztéshez elég)
Vagy .xpi csomagként telepítve (maradandó):


cd /home/martonlaszloattila/Documents/develop/Thunderbird_translate
zip -r ../email-translator.xpi . --exclude "_work/*" --exclude "*.xpi"
Majd Thunderbird → Add-ons → fogd rá a fájlt.

2. A tesztelési mátrix sorrendben

A roadmapban lévő teszteket így érdemes lefuttatni:

Alapműködés:

Nyiss meg egy IMAP e-mailt → kattints a toolbar gombra → megjelenik-e a split view?
Kattints a × gombra → eltűnik-e a split view, visszaáll-e az eredeti nézet?
Kattints újra a gombra → visszajön-e (cache-ből, gyorsan)?
Fordítók:
4. Settings → provider: MyMemory → fordíts egy angol e-mailt magyarra
5. Settings → provider: DeepL → adj meg egy ingyenes API kulcsot → fordíts HTML e-mailt (megmarad-e a formázás?)

Szélsőesetek:
6. Plain text e-mail (nem HTML) → működik-e?
7. Quoted-printable kódolt e-mail (pl. Google figyelmeztetés) → helyes karakterek?
8. Nagyon hosszú e-mail (5000+ karakter) → megjelenik-e a csonkítás figyelmeztetés?
9. Hálózat nélkül (repülő mód) → hibaüzenet jelenik meg a split view-ban?

Auto-translate:
10. Settings → Auto-translate bekapcsolva → nyiss meg egy új e-mailt → automatikusan fordít?
11. Kapcsold ki → gombnyomás nélkül ne fordítson

Több tab:
12. Nyiss meg két e-mailt külön tabban → az egyiken fordíts → csak az aktív tabon jelenik meg?

Megjelenés:
13. Sötét Thunderbird témával → a jobb panel hátterszíne egyezik-e az eredetivel?
14. Húzd a középső elválasztót → átméretezhető-e a két panel?

3. Hibák megjelenítése

Ha valami nem működik, nyisd meg a konzolt:

about:debugging → az extension melletti "Inspect" gomb
Ez megnyitja a DevTools-t a background script kontextusában
A console.error / console.warn üzenetek itt jelennek meg