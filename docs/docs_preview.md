# Documentation Preview Workflow

Posterizarr publishes production documentation from `main` and a separate
preview from the `dev` branch. The preview does not replace the live
documentation.

## First-time setup

1. In the GitHub repository, create a branch named `dev` from `main` if it does
  not already exist.
2. Keep GitHub Pages publishing from the existing `gh-pages` branch.
3. Push a commit to `dev`, or manually run **Deploy Docs Preview** from the
  Actions tab with `dev` selected as the branch.

The preview will be available at
<https://fscorrupt.github.io/posterizarr/preview/>. It can take a short time to
appear after the workflow finishes.

## Preview changes

Make documentation, navigation, or theme changes on `dev`. Each push
builds the site with the pinned Zensical version and replaces only the
`/preview/` copy on GitHub Pages. The production site at
<https://fscorrupt.github.io/posterizarr/> remains unchanged.

When the preview is ready, merge the changes into `main`. The production
workflow publishes the updated root site and preserves the preview folder.

## Notes

### Add Showcase Images

Place JPG, JPEG, PNG, or WebP images in `docs/images/artwork/`. Use the next
available number within that contributor's series, for example `1-name.webp`
and `2-name.jpg`. Each new contributor starts at 1.
Images are naturally sorted and split into portrait and landscape strips.
There are no permanent captions or gallery playback buttons. On the showcase
page, credits appear over the image on hover, keyboard focus, or tap, without
a modal. The compact home gallery links directly to the showcase and has no
credit overlays.
Maintain per-file titles, formats, and contributors in
`docs/images/artwork/credits.json`; uncredited additions are never assigned to
another contributor automatically.

Both publishing workflows regenerate the gallery automatically. For a local
preview after adding images, run:

```bash
python docs/tools/build_artwork_gallery.py
python -m zensical serve
```

The original descriptive filenames remain valid to preserve existing links.
The gallery includes six native artwork captures, including the anime titlecard
`6-fscorrupt.jpg`; `native-background.jpg` is kept on disk but excluded from the
gallery. These examples credit the imported
[fscorrupt Community Config](https://github.com/Kometa-Team/Community-Configs/tree/master/fscorrupt).
Artwork belongs to its respective
rights holders. Add only images you have permission to publish.

Files `1-kytte77.png` through `5-kytte77.png` were contributed by **kytte77** and copied
unchanged from the supplied examples. Their overlays adapt
[olli991/Kometa-overlay](https://github.com/olli991/Kometa-overlay), with
adjustments; the original overlay work comes from that project and its
[jmxd presets](https://github.com/jmxd/Kometa) foundation. This attribution is
shown in the corresponding images' hover information.

The scroller is an independent CSS/JavaScript implementation, visually inspired
by Kometa Wiki. No Kometa scroller code was copied; a short inspiration credit
is shown below the gallery, separately from artwork and overlay-source credits.

- Both workflows serialize Pages deployments so concurrent builds cannot
  overwrite each other's changes.
- The preview branch is a regular Git branch; this repository checkout may not
  include it locally. Create it in GitHub or in a full Git clone.
- Zensical currently reads the existing `mkdocs.yml`; the site has not been
  converted to `zensical.toml`.