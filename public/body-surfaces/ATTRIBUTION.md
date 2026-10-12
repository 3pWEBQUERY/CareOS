# Anatomical body surfaces

The male and female exterior skin meshes in this directory are adapted from
[Human Atlas](https://github.com/slorksmo/Human-Atlas), licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Source revision: `5bb5713aab18d7fe9380c3339eb09f173491ea06`.

- Male surface: BodyParts3D 4.0, © The Database Center for Life Science (DBCLS).
- Female surface: Human Reference Atlas / HuBMAP, Kristen Browne and Heidi Schlehlein, based on the Visible Human Project of the U.S. National Library of Medicine.

Only the `Skin` geometry is redistributed here. The original packed model chunks
were reduced to position, normal and index buffers, scaled and recolored at runtime.
No internal anatomy or individual patient data is included in these assets.
Regenerate them with `node scripts/build-body-surfaces.mjs`.
