---
'inlaytrace': patch
---

Small text and dots beside flat art now trace. Thin anti-aliased strokes (1.5 px grey letters) were labelled as the paper, pale edges as a nearby colour, and each letter then cleared as a speck. In flat art (not `photo`), a pixel between colours and close to none of them is now read as a mix of the pair that explains it best; one next to only one other colour keeps its own; and a speck that stands well apart from every colour around it stays from an eighth of the speck area up, so raising `speckle` still clears it. Poster output is unchanged.
