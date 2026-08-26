// YPL Team Builder Alpha
// Regulation data is intentionally isolated from UI/validation logic.
// Add future regulations (e.g. M-C) by adding another object to REGULATIONS.

const MB_NEW = new Set([
  'Vileplume','Qwilfish','Sceptile','Blaziken','Swampert','Mawile','Metagross','Staraptor',
  'Musharna','Scolipede','Scrafty','Eelektross','Pyroar','Malamar','Barbaracle','Dragalge',
  'Grimmsnarl','Falinks','Overqwil','Houndstone','Annihilape','Gholdengo'
]);

const MB_POKEMON = `
Vileplume
Qwilfish
Sceptile
Blaziken
Swampert
Mawile
Metagross
Staraptor
Musharna
Scolipede
Scrafty
Eelektross
Pyroar
Malamar
Barbaracle
Dragalge
Grimmsnarl
Falinks
Overqwil
Houndstone
Annihilape
Gholdengo
Venusaur
Charizard
Blastoise
Beedrill
Pidgeot
Arbok
Pikachu
Raichu
Raichu [Alolan Form]
Clefable
Ninetales
Ninetales [Alolan Form]
Arcanine
Arcanine [Hisuian Form]
Alakazam
Machamp
Victreebel
Slowbro
Slowbro [Galarian Form]
Gengar
Kangaskhan
Starmie
Pinsir
Tauros
Tauros [Paldean Form (Combat Breed)]
Tauros [Paldean Form (Blaze Breed)]
Tauros [Paldean Form (Aqua Breed)]
Gyarados
Ditto
Vaporeon
Jolteon
Flareon
Aerodactyl
Snorlax
Dragonite
Meganium
Typhlosion
Typhlosion [Hisuian Form]
Feraligatr
Ariados
Ampharos
Azumarill
Politoed
Espeon
Umbreon
Slowking
Slowking [Galarian Form]
Forretress
Steelix
Scizor
Heracross
Skarmory
Houndoom
Tyranitar
Pelipper
Gardevoir
Sableye
Aggron
Medicham
Manectric
Sharpedo
Camerupt
Torkoal
Altaria
Milotic
Castform
Banette
Chimecho
Absol
Glalie
Torterra
Infernape
Empoleon
Luxray
Roserade
Rampardos
Bastiodon
Lopunny
Spiritomb
Garchomp
Lucario
Hippowdon
Toxicroak
Abomasnow
Weavile
Rhyperior
Leafeon
Glaceon
Gliscor
Mamoswine
Gallade
Froslass
Rotom
Heat Rotom
Wash Rotom
Frost Rotom
Fan Rotom
Mow Rotom
Serperior
Emboar
Samurott
Samurott [Hisuian Form]
Watchog
Liepard
Simisage
Simisear
Simipour
Excadrill
Audino
Conkeldurr
Whimsicott
Krookodile
Cofagrigus
Garbodor
Zoroark
Zoroark [Hisuian Form]
Reuniclus
Vanilluxe
Emolga
Chandelure
Beartic
Stunfisk
Stunfisk [Galarian Form]
Golurk
Hydreigon
Volcarona
Chesnaught
Delphox
Greninja
Diggersby
Talonflame
Vivillon [High Plains Pattern]
Florges
Florges [Yellow Flower]
Florges [Orange Flower]
Florges [Blue Flower]
Florges [White Flower]
Pangoro
Furfrou
Furfrou [Matron Trim]
Furfrou [Dandy Trim]
Meowstic
Meowstic [Female]
Aegislash
Aromatisse
Slurpuff
Clawitzer
Heliolisk
Tyrantrum
Aurorus
Sylveon
Hawlucha
Dedenne
Goodra
Goodra [Hisuian Form]
Klefki
Trevenant
Gourgeist
Gourgeist [Small Variety]
Gourgeist [Large Variety]
Gourgeist [Jumbo Variety]
Avalugg
Avalugg [Hisuian Form]
Noivern
Decidueye
Decidueye [Hisuian Form]
Incineroar
Primarina
Toucannon
Crabominable
Lycanroc
Lycanroc [Midnight Form]
Lycanroc [Dusk Form]
Toxapex
Mudsdale
Araquanid
Salazzle
Tsareena
Oranguru
Passimian
Mimikyu
Drampa
Kommo-o
Corviknight
Flapple
Appletun
Sandaconda
Polteageist
Polteageist [Antique Form]
Hatterene
Mr. Rime
Runerigus
Alcremie
Alcremie [Ruby Cream]
Alcremie [Matcha Cream]
Alcremie [Mint Cream]
Alcremie [Lemon Cream]
Alcremie [Salted Cream]
Alcremie [Ruby Swirl]
Alcremie [Caramel Swirl]
Alcremie [Rainbow Swirl]
Morpeko
Dragapult
Wyrdeer
Kleavor
Basculegion
Basculegion [Female]
Sneasler
Meowscarada
Skeledirge
Quaquaval
Maushold
Maushold [Family of Four]
Garganacl
Armarouge
Ceruledge
Bellibolt
Scovillain
Espathra
Tinkaton
Palafin
Orthworm
Glimmora
Farigiraf
Kingambit
Sinistcha
Sinistcha [Masterpiece Form]
Archaludon
Hydrapple
`.trim().split('\n').map((name, index) => ({
  id: `mb-${index + 1}`,
  name: name.trim(),
  isNewInMB: MB_NEW.has(name.trim())
}));

const MA_POKEMON = MB_POKEMON.filter(p => !p.isNewInMB).map((p, index) => ({
  ...p,
  id: `ma-${index + 1}`,
  isNewInMB: false
}));

export const REGULATIONS = {
  'm-b': {
    id: 'm-b',
    name: 'Regulation M-B',
    shortName: 'M-B',
    status: 'current',
    period: '2026.06.17 – 2026.09.09',
    description: 'Pokémon Champions 현행 Regulation M-B 포켓몬 풀',
    maxTeamSize: 6,
    pokemon: MB_POKEMON,
  },
  'm-a': {
    id: 'm-a',
    name: 'Regulation M-A',
    shortName: 'M-A',
    status: 'past',
    period: '2026.04.08 – 2026.06.17',
    description: '이전 Regulation M-A 포켓몬 풀',
    maxTeamSize: 6,
    pokemon: MA_POKEMON,
  }
};

