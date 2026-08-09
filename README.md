# Upgrade Board

A Foundry VTT module for running an upgrade board. The party banks a shared resource and spends it
on upgrades you wrote yourself, each with its own art, flavour line, description, and optionally a
real mechanical effect.

None of the words your players read are fixed. The currency, the merchant, the window title, the
action verb and the colour theme are all settings. The same module can be a pearl merchant in one
campaign and a memorial garden in the next, without touching any code.

Mechanical effects are supported in PF2e and dnd5e. Everything else works in any system.

![The board, in the Grove theme](media/01-board.jpg)


## The board

Upgrades show up as a grid of cards. A card knows whether you can afford it, whether you already own
it, whether something else has to come first, and whether it is still a secret. Each one carries a
short excerpt from its description so the board can be read at a glance, with the full text on click.

You can group upgrades under your own headings, like "Lighthouse" or "Runes and Enchanting", and
reorder them from the GM console. Deleting a heading keeps the upgrades inside it.

An upgrade can require others before it becomes available. Until then it stays on the board but
locked, and it tells the player what would unlock it rather than just refusing. Cards on a path are
ordered so the prerequisite always comes first, and the two are drawn as linked. You cannot author a
loop by accident.

You can also mark upgrades as mutually exclusive, for when the party gets one of several options.
Tick the rivals on any one of them and you are done. There is nothing to create first, and you only
have to say it on one side. The links close transitively, so A against B plus B against C becomes a
single set of three, and the editor tells you the whole set as you build it. Every card in an open
choice says so before anyone commits, and the ones that lose say which rival closed them. Refund the
purchase and the rest open back up, because the exclusion is worked out from the purchase record
rather than written into the losing cards. The check also runs on the GM's client, so two players
cannot grab opposite sides of the same choice at the same moment.

There are sixteen themes. The fantasy ones are Abyss, Grove, Ember, Arcane, Frost, Ossuary,
Bloodmoon, Golden Hall, Mycelium, Tempest and Parchment. The sci-fi ones are Holo, Neon, Starship,
Rust and Phosphor. Parchment and Starship are light, the rest are dark. A theme only swaps the
palette, so they all get layout fixes for free.

![The setup window, with every theme and a live preview](media/03-setup-themes.jpg)

You pick a theme by looking at it rather than by name, and the preview beside the swatches updates
as you type.

## Buying

Most tables want a single resource, and that is what you get out of the box. If you want a compound
economy you can define more, and then any upgrade can be priced in any mix of them, so something
might cost 3 Sprigs and 1 Pearl of Power. With one resource the interface stays exactly as simple as
it was.

By default players request an upgrade and you get a dialog to approve or decline. Approving deducts
the cost and posts an announcement to chat. You can turn approval off if your table does not need
it, and buying something yourself never asks you to approve your own purchase.

Every upgrade knows who it lands on. That can be the whole party, whoever buys it, or one named
character you pick in the editor. "Whoever buys it" is resolved at the moment of purchase from the
buyer's own character, so you do not have to know in advance.

Mark an upgrade repeatable and it can be bought again. The card then shows a running tally instead
of an Owned stamp, each purchase is tracked on its own, and refunds come off one at a time.

An upgrade can also ask the buyer a question before they pay. They drag a document into the prompt
and it names the thing they get, so a "Temporary Scroll" becomes "Temporary Scroll (Fireball)" with
a link to the spell in its description. Cancelling the prompt buys nothing.

## Effects

Each upgrade works in one of three ways.

| Mode | What it does |
| --- | --- |
| Cosmetic | Nothing mechanical. Just the card, the art and the announcement. Plenty of upgrades want exactly this. |
| Build a bonus | Pick a target from a plain language list and type a value. No data paths, no UUIDs. |
| Link | Drag in any Effect or Item you already have and grant a copy of it. |

The bonus builder knows which system you are running.

In PF2e it produces rule elements, using `FlatModifier` for flat bonuses and `DamageDice` for extra
dice. Targets are semantic selectors rather than data paths, covering attack, AC, the three saves,
all sixteen skills, perception, spell attack and DC, class DC, hit points and the speeds. Bonus type
is a choice you make rather than a hidden default, because in PF2e the type is what decides whether
something stacks. Each option explains what it will refuse to stack with.

In dnd5e it produces ActiveEffect changes. The melee and ranged fan-out is handled for you, ability
scores and darkvision are treated as the plain numbers they are, and there is a damage type dropdown
so nobody has to type `[cold]` by hand.

![Building a bonus without touching a data path](media/04-bonus-builder.jpg)


Resistance, immunity and vulnerability are offered as ordinary choices in both systems instead of
being left to the custom row. You pick the damage type from a dropdown, plus an amount where the
system takes one. PF2e gets real Resistance, Weakness and Immunity rule elements. dnd5e adds the
type to `system.traits.dr` and its siblings. Neither one is a bonus, so neither asks you for a
stacking type.

Condition immunity works the same way, from each system's own condition list.

Some rewards are not a number at all, and those are offered as themselves rather than left to the
custom row. You can grant advantage or disadvantage on ability checks, saving throws, initiative,
concentration and death saves, and the module writes it the way each system understands it: dnd5e
counts a source of advantage into the roll mode, so two sources do not stack into something absurd
and a matching disadvantage cancels it, and PF2e gets a real fortune or misfortune effect that
rolls twice. You can grant a sense in either system, and in dnd5e you can switch on any of the
system's own special traits, including a lower critical hit threshold.

Concentration is a dnd5e only section, because PF2e has no such thing. The limit is a real field
the system enforces, so "you can concentrate on two spells at once" is one number rather than a
note in the description.

Two things the builder deliberately does not try to do. It will not make your damage ignore a
target's resistance, because neither system stores that on the attacker: it is a choice made in
the damage application window when the damage lands. And it does not do triggered abilities, the
"once per turn" and "when you drop to 0 hit points" kind. Those are items with use counters, which
is what link mode is for: build the feature once, drag it onto the upgrade, and buying it hands
over a copy.

Any other system gets the custom target row and link mode.

## Where it sits in your world

You can bind an actor as the merchant, and then double clicking their token opens the window. Turn
off "players can open the window themselves" alongside that and visiting them becomes the only way
in. Foundry only delivers a double click to a token the player is allowed to see, so setup warns you
when your players have no access to that actor, and offers to grant the smallest permission that
lets the click through.

You can also nominate an Item worth one unit of currency. Place stacks of it into a chest or onto a
body from the console, let the party loot it, and they hand it in from the window. If you would
rather looting be the whole interaction, there is a setting to credit it the moment they pick it up.

## Housekeeping

Everything the module grants is tagged with both the upgrade and the purchase it came from. Refund
something, delete it, or edit it, and exactly what it created gets removed or rebuilt. Nothing is
left behind on a sheet.

Re-sync rebuilds anything that has gone missing on the current targets. It is there for late
joiners, roster changes, and the effect someone deleted off their sheet by hand.

Every purchase and adjustment is logged with a reason, and the log is editable. Reword a line, drop
one, or sweep the whole thing, either all of it or just the adjustments or just the purchases. It is
a record and nothing is read back out of it, so clearing a run of trial and error moves no currency
and un-buys nothing.

![The GM console](media/02-gm-console.jpg)


## Install

Paste this into Add-on Modules, Install Module, in the Manifest URL field underneath the search
results:

```
https://github.com/Geda173/upgrade-board/releases/latest/download/module.json
```

The module is not in Foundry's package registry, so searching for it by name will not find it.

For development, clone into your Foundry data directory as `Data/modules/upgrade-board`.

Open it from the gem button in the token scene controls, from the merchant's token, or from a macro:

```js
game.modules.get("upgrade-board").api.openShop();     // the player window
game.modules.get("upgrade-board").api.openEditor();   // the GM console
game.modules.get("upgrade-board").api.openSettings(); // setup
```

## Upgrading from "Upgrades"

This module used to be called `upgrades`. Foundry files world data under the module id, so a world
set up with the old one would otherwise open with an empty board.

Install it as a new module, using the manifest URL above. Foundry will not offer it as an update
to the old one, because a renamed module is a different module as far as it is concerned.

It carries itself across. The first time a GM loads a world that has an old board in it, the
catalogue, sections, balances, currencies, history and all your settings are copied onto the new id
and you get a notification saying so. Nothing is deleted, so the old data stays where it is and
reinstalling the old module puts you back exactly as you were.

Two things worth knowing. Effects granted by the old module are still recognised, so refunds and
deletions clean up after them properly. And once the copy has happened you should disable the old
module, because two copies both add a scene control button and both listen for a double click on
the merchant.

## Setup

Everything is configured inside the module. Press the gem button, then Setup. Foundry's own settings
list holds a single button that opens the same window, because you cannot pick a theme from a
dropdown of names. The setup window shows a live preview that updates as you type.

1. Party actor. Point this at your PF2e Party or dnd5e Group actor. Without it, party-wide upgrades
   fall back to every player-owned character, which in a world of any age also means chests, item
   piles, summons and wildshape copies. This is the one setting that will bite you if you skip it.
2. Resources. One exists already. Add more only if you want a compound economy.
3. Vocabulary. Currency name, icon, window title, action verb, merchant name and greeting.
4. Theme. Pick it by looking at it.
5. Optionally a merchant actor, a currency item, and whether pickups credit automatically.

## Languages

Ships in English, German, French, Italian and Spanish. Everything is translated: the player window,
the GM console, the editor, setup, both bonus catalogues, and every dialog and notification.

The four translations beyond English were machine assisted and have not been checked by a native
speaker, apart from German. If something reads badly in your language, the fix is one line in one
file and a pull request is very welcome. Game terms like skill and save names follow each system's
own wording, so they should line up with what your character sheet already says.

To add a language, copy `lang/en.json`, translate the values, and add one entry to the `languages`
array in `module.json`. Nothing in the code needs touching. A test checks that every language file
has exactly the same keys as English and keeps every `{placeholder}`, so a missing line fails the
build rather than showing up as raw text in somebody's game.

## Worth knowing

All world changes run on the GM's client, so somebody with a GM login has to be connected for a
purchase to go through. The module says so up front rather than letting a request vanish.

Physical currency is matched by item name, so copies you make by hand still count. Pick a name you
will not reuse for something else.

Art is referenced by path into your Foundry data folder. Use the browse button in the editor rather
than typing paths.

## Development

```bash
npm install   # handlebars only, for the template tests
npm test      # or: node tests/run.mjs [name-fragment]
```

No build step and no framework. Each suite is a standalone ES module that prints PASS or FAIL, and
the runner spawns them and adds up the totals. Every suite is there because something broke once,
and `CLAUDE.md` records which bug each one is guarding. Tests are left out of the release zip.

## Roadmap

A starter effect compendium, predicates on PF2e bonuses for conditional "only against undead" style
effects, catalogue export and import, and a purchase sound.
