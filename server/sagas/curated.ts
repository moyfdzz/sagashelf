/**
 * The sagas that are curated by hand (SAG-25, ADR-026). Each one lists its works as Wikidata items,
 * in the order of the story; the release order comes from the year Wikidata gives. The lists were
 * built on 2026-10-31 from the members of each media franchise (`P8345`) that are a film, a
 * series, an anime, a manga or a book and that a catalog we use knows (TMDB, MyAnimeList, AniList
 * or Open Library), minus what is not part of the story (toys, shorts for children, fan films). A franchise
 * member Wikidata lacks is not here. To add a work or a saga, add its item and open a PR: the
 * cron saves it (`server/jobs/sync-sagas.ts`).
 */
export type CuratedSaga = {
  slug: string;
  titles: { es: string; en: string };
  /** Wikidata items in the order of the story (the release order unless it says otherwise). */
  members: readonly string[];
};

export const curatedSagas: readonly CuratedSaga[] = [
  {
    slug: "attack-on-titan",
    titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
    members: [
      "Q586025", // Attack on Titan (2009)
      "Q21160018", // Attack on Titan: Before the Fall (2011)
      "Q20856829", // Attack on Titan: Junior High (2012)
      "Q22126305", // Attack on Titan (2013)
      "Q24037178", // Attack on Titan: No Regrets (2013)
      "Q24037378", // Spoof on Titan (2013)
      "Q108860140", // Attack on Titan: Before the Fall (2013)
      "Q24034448", // Attack on Titan: Harsh Mistress of the City (2014)
      "Q20313191", // Attack on Titan (2015)
      "Q48989907", // Attack on Titan: Counter Rockets (2015)
      "Q108860567", // Attack on Titan: Lost Girls (2015)
      "Q108860715", // Attack on Titan: Junior High (2015)
      "Q108860922", // Attack on Titan: High School (2018)
    ],
  },
  {
    slug: "death-note",
    titles: { es: "Death Note", en: "Death Note" },
    members: [
      "Q1834", // Death Note (2003)
      "Q718624", // Death Note (2006)
      "Q1200673", // Death Note (2006)
      "Q2279512", // Death Note 2: The Last Name (2006)
      "Q1370936", // L: Change the World (2008)
      "Q19961524", // Death Note (2015)
      "Q23013583", // Death Note: Light Up the New World (2016)
      "Q22077183", // Death Note (2017)
    ],
  },
  {
    slug: "demon-slayer",
    titles: {
      es: "Demon Slayer: Kimetsu no Yaiba",
      en: "Demon Slayer: Kimetsu no Yaiba",
    },
    members: [
      "Q24862683", // Demon Slayer: Kimetsu no Yaiba (2016)
      "Q63350570", // Demon Slayer: Kimetsu no Yaiba (2019)
      "Q96376192", // Demon Slayer: Kimetsu no Yaiba the Movie: Mugen Train (2020)
    ],
  },
  {
    slug: "jujutsu-kaisen",
    titles: { es: "Jujutsu Kaisen", en: "Jujutsu Kaisen" },
    members: [
      "Q106392064", // Jujutsu Kaisen 0 (2017)
      "Q55522899", // Jujutsu Kaisen (2018)
      "Q98836216", // Jujutsu Kaisen (2020)
      "Q136436677", // Jujutsu Kaisen: Execution (2025)
    ],
  },
  {
    slug: "my-hero-academia",
    titles: { es: "My Hero Academia", en: "My Hero Academia" },
    members: [
      "Q18047903", // My Hero Academia (2014)
      "Q106392490", // My Hero Academia Smash!! (2015)
      "Q63686324", // My Hero Academia (2016)
      "Q106091435", // My Hero Academia: Vigilantes (2016)
      "Q55391732", // My Hero Academia: Two Heroes (2018)
      "Q85846725", // My Hero Academia: Heroes Rising (2019)
      "Q106392495", // My Hero Academia: Team-Up Mission (2019)
      "Q107130536", // My Hero Academia: World Heroes' Mission (2021)
      "Q124388041", // My Hero Academia: You're Next (2024)
      "Q131534559", // My Hero Academia: Vigilantes (2025)
    ],
  },
  {
    slug: "chainsaw-man",
    titles: { es: "Chainsaw Man", en: "Chainsaw Man" },
    members: [
      "Q65240543", // Chainsaw Man (2018)
      "Q104211858", // Chainsaw Man (2022)
    ],
  },
  {
    slug: "spy-x-family",
    titles: { es: "Spy × Family", en: "Spy × Family" },
    members: [
      "Q65231576", // Spy × Family (2019)
      "Q109333365", // Spy × Family (2022)
      "Q117305646", // Spy x Family Code: White (2023)
    ],
  },
  {
    slug: "vinland-saga",
    titles: { es: "Vinland Saga", en: "Vinland Saga" },
    members: [
      "Q930990", // Vinland Saga (2005)
      "Q64063188", // Vinland Saga (2019)
    ],
  },
  {
    slug: "berserk",
    titles: { es: "Berserk", en: "Berserk" },
    members: [
      "Q18558978", // Berserk (1989)
      "Q18559016", // Berserk (1997)
    ],
  },
  {
    slug: "cowboy-bebop",
    titles: { es: "Cowboy Bebop", en: "Cowboy Bebop" },
    members: [
      "Q43183359", // Cowboy Bebop: Shooting Star (1998)
      "Q43183511", // Cowboy Bebop (1998)
      "Q101244908", // Cowboy Bebop (1998)
      "Q1334287", // Cowboy Bebop: The Movie (2001)
      "Q101252448", // Cowboy Bebop (2021)
    ],
  },
  {
    slug: "neon-genesis-evangelion",
    titles: { es: "Neon Genesis Evangelion", en: "Neon Genesis Evangelion" },
    members: [
      "Q662", // Neon Genesis Evangelion (1995)
      "Q967664", // Neon Genesis Evangelion: Death & Rebirth (1997)
      "Q1151814", // The End of Evangelion (1997)
      "Q579209", // Evangelion: 1.0 You Are (Not) Alone (2007)
      "Q2040810", // Neon Genesis Evangelion: Campus Apocalypse (2007)
      "Q614200", // Evangelion: 2.0 You Can (Not) Advance (2009)
      "Q182206", // Evangelion: 3.0 You Can (Not) Redo (2012)
      "Q6434144", // Evangelion: 3.0+1.0 Thrice Upon a Time (2021)
      "Q1977621", // Neon Genesis Evangelion
      "Q6040842", // Neon Genesis Evangelion: ANIMA
      "Q13471331", // Neon Genesis Evangelion: Angelic Days
    ],
  },
  {
    slug: "fullmetal-alchemist",
    titles: { es: "Fullmetal Alchemist", en: "Fullmetal Alchemist" },
    members: [
      "Q189562", // Fullmetal Alchemist (2001)
      "Q711257", // Fullmetal Alchemist (2003)
      "Q699684", // Fullmetal Alchemist the Movie: Conqueror of Shamballa (2005)
      "Q437808", // Fullmetal Alchemist: Brotherhood (2009)
      "Q1004318", // Fullmetal Alchemist: The Sacred Star of Milos (2011)
      "Q24228311", // Fullmetal Alchemist (2017)
    ],
  },
  {
    slug: "naruto",
    titles: { es: "Naruto", en: "Naruto" },
    members: [
      "Q26971382", // Naruto (1999)
      "Q25929253", // Naruto (2002)
      "Q75682", // Naruto Shippuden the Movie: The Lost Tower (2010)
      "Q48699036", // Naruto: The Seventh Hokage and the Scarlet Spring (2015)
      "Q100774832", // Boruto (2017)
    ],
  },
  {
    slug: "bleach",
    titles: { es: "Bleach", en: "Bleach" },
    members: [
      "Q12685666", // Bleach (2001)
      "Q5362638", // Bleach (2004)
      "Q804434", // Bleach: Memories of Nobody (2006)
      "Q804429", // Bleach: The DiamondDust Rebellion (2007)
      "Q1363909", // Bleach: Fade to Black (2008)
      "Q24673", // Bleach: Hell Verse (2010)
      "Q27958503", // Bleach (2018)
    ],
  },
  {
    slug: "one-piece",
    titles: { es: "One Piece", en: "One Piece" },
    members: [
      "Q28667972", // One Piece (1997)
      "Q710324", // One Piece (1999)
      "Q1209459", // One Piece (2000)
      "Q1186160", // One Piece: Clockwork Island Adventure (2001)
      "Q1134641", // One Piece: The Cursed Holy Sword (2004)
      "Q1048739", // One Piece: The Giant Mechanical Soldier of Karakuri Castle (2006)
      "Q1048722", // One Piece Movie 9: Episode of Chopper Plus - Fuyu ni Saku, Kiseki no Sakura (2008)
      "Q109638221", // One Piece Film: Red (2022)
      "Q109526557", // One Piece (2023)
    ],
  },
  {
    slug: "dragon-ball",
    titles: { es: "Dragon Ball", en: "Dragon Ball" },
    members: [
      "Q15051307", // Dragon Ball (1984)
      "Q239506", // Dragon Ball (1986)
      "Q1255021", // Dragon Ball: Curse of the Blood Rubies (1986)
      "Q477916", // Dragon Ball Z (1989)
      "Q1254986", // Dragon Ball Z: The Tree of Might (1990)
      "Q735669", // Dragon Ball GT (1996)
      "Q909574", // Dragon Ball GT: A Hero's Legacy (1997)
      "Q653303", // Dragonball Evolution (2009)
      "Q704651", // Dragon Ball Z Kai (2009)
      "Q19839121", // Dragon Ball Super (2015)
      "Q64230248", // Dragon Ball Super (2015)
      "Q17476655", // Dragon Ball Z: Resurrection 'F' (2015)
      "Q123022503", // Dragon Ball Daima (2024)
      "Q137883816", // Dragon Ball Super: Beerus (2026)
    ],
  },
  {
    slug: "breaking-bad",
    titles: { es: "Breaking Bad", en: "Breaking Bad" },
    members: [
      "Q1079", // Breaking Bad (2008)
      "Q14925221", // Better Call Saul (2015)
      "Q61741521", // El Camino: A Breaking Bad Movie (2019)
    ],
  },
  {
    slug: "the-matrix",
    titles: { es: "Matrix", en: "The Matrix" },
    members: [
      "Q83495", // The Matrix (1999)
      "Q189600", // The Matrix Reloaded (2003)
      "Q207536", // The Matrix Revolutions (2003)
      "Q335340", // The Animatrix (2003)
      "Q80322391", // The Matrix Resurrections (2021)
    ],
  },
  {
    slug: "dune",
    titles: { es: "Dune", en: "Dune" },
    members: [
      "Q190192", // Dune (novel) (1965)
      "Q114819", // Dune (1984)
      "Q987305", // Frank Herbert's Dune (2000)
      "Q60834962", // Dune (2021)
      "Q109228991", // Dune: Part Two (2024)
    ],
  },
  {
    slug: "harry-potter",
    titles: { es: "Harry Potter", en: "Harry Potter" },
    members: [
      "Q43361", // Harry Potter and the Philosopher's Stone (novel) (1997)
      "Q102438", // Harry Potter and the Philosopher's Stone (2001)
      "Q102244", // Harry Potter and the Chamber of Secrets (2002)
      "Q102448", // Harry Potter and the Prisoner of Azkaban (2004)
      "Q102225", // Harry Potter and the Goblet of Fire (2005)
      "Q102235", // Harry Potter and the Order of the Phoenix (2007)
      "Q161687", // Harry Potter and the Half-Blood Prince (2009)
      "Q161678", // Harry Potter and the Deathly Hallows – Part 1 (2010)
      "Q232009", // Harry Potter and the Deathly Hallows – Part 2 (2011)
      "Q18199330", // Fantastic Beasts and Where to Find Them (2016)
      "Q18199331", // Fantastic Beasts: The Crimes of Grindelwald (2018)
      "Q18199332", // Fantastic Beasts: The Secrets of Dumbledore (2022)
    ],
  },
  {
    slug: "star-wars",
    titles: { es: "Star Wars", en: "Star Wars" },
    members: [
      "Q104161310", // The Acolyte (2024)
      "Q112170063", // Tales of the Jedi (2022)
      "Q165713", // Star Wars: Episode I – The Phantom Menace (1999)
      "Q181069", // Star Wars: Episode II – Attack of the Clones (2002)
      "Q616313", // Star Wars: Clone Wars (2003)
      "Q632672", // Star Wars: The Clone Wars (2008)
      "Q42051", // Star Wars: Episode III – Revenge of the Sith (2005)
      "Q97365172", // Star Wars: The Bad Batch (2021)
      "Q27038847", // Solo: A Star Wars Story (2018)
      "Q104154217", // Obi-Wan Kenobi (2022)
      "Q60462338", // Andor (2022)
      "Q19590955", // Rogue One: A Star Wars Story (2016)
      "Q28787", // Star Wars Rebels (2014)
      "Q17738", // Star Wars: Episode IV – A New Hope (1977)
      "Q181795", // Star Wars: Episode V – The Empire Strikes Back (1980)
      "Q181803", // Star Wars: Episode VI – Return of the Jedi (1983)
      "Q56876444", // The Mandalorian (2019)
      "Q104396610", // The Book of Boba Fett (2021)
      "Q104153367", // Ahsoka (2023)
      "Q52346040", // Star Wars Resistance (2018)
      "Q6074", // Star Wars: Episode VII – The Force Awakens (2015)
      "Q18486021", // Star Wars: Episode VIII – The Last Jedi (2017)
      "Q20977110", // Star Wars: Episode IX – The Rise of Skywalker (2019)
      "Q104161600", // Star Wars: Visions (2021)
      "Q125338461", // Star Wars: Tales of the Empire (2024)
      "Q133810179", // Star Wars: Tales of the Underworld (2025)
      "Q124246549", // The Mandalorian and Grogu (2026)
      "Q134533491", // Star Wars: Maul – Shadow Lord (2026)
    ],
  },
];
