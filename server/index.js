import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import webPush from 'web-push';
import {
  loadElmProfiles,
  saveElmProfiles,
  appendElmLog,
  getElmLogs,
  getElmProfileSummary,
  sanitizeElmProfilesForClient
} from './elm-uds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const OWNER_CODE = process.env.OWNER_CODE || 'DIAGAUTO-OWNER';
const IMPORT_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000;

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const clone = (v) => JSON.parse(JSON.stringify(v));

const BRANDS_RAW = [
  ['BR-RENAULT','Renault','FR','EUROPE'],['BR-PEUGEOT','Peugeot','FR','EUROPE'],['BR-CITROEN','Citroën','FR','EUROPE'],
  ['BR-DS','DS Automobiles','FR','EUROPE'],['BR-ALPINE','Alpine','FR','EUROPE'],['BR-BUGATTI','Bugatti','FR','EUROPE'],
  ['BR-AIXAM','Aixam','FR','EUROPE'],['BR-LIGIER','Ligier','FR','EUROPE'],['BR-MICROCAR','Microcar','FR','EUROPE'],
  ['BR-VOLKSWAGEN','Volkswagen','DE','EUROPE'],['BR-AUDI','Audi','DE','EUROPE'],['BR-BMW','BMW','DE','EUROPE'],
  ['BR-MERCEDES-BENZ','Mercedes-Benz','DE','EUROPE'],['BR-PORSCHE','Porsche','DE','EUROPE'],['BR-OPEL','Opel','DE','EUROPE'],
  ['BR-SMART','Smart','DE','EUROPE'],['BR-MAN','MAN','DE','EUROPE'],['BR-ALPINA','Alpina','DE','EUROPE'],
  ['BR-FIAT','Fiat','IT','EUROPE'],['BR-FERRARI','Ferrari','IT','EUROPE'],['BR-LAMBORGHINI','Lamborghini','IT','EUROPE'],
  ['BR-MASERATI','Maserati','IT','EUROPE'],['BR-PAGANI','Pagani','IT','EUROPE'],['BR-ALFA-ROMEO','Alfa Romeo','IT','EUROPE'],
  ['BR-LANCIA','Lancia','IT','EUROPE'],['BR-IVECO','Iveco','IT','EUROPE'],['BR-SEAT','SEAT','ES','EUROPE'],
  ['BR-CUPRA','Cupra','ES','EUROPE'],['BR-SKODA','Škoda','CZ','EUROPE'],['BR-DACIA','Dacia','RO','EUROPE'],
  ['BR-VOLVO','Volvo','SE','EUROPE'],['BR-POLESTAR','Polestar','SE','EUROPE'],['BR-KOENIGSEGG','Koenigsegg','SE','EUROPE'],
  ['BR-ASTON-MARTIN','Aston Martin','GB','EUROPE'],['BR-MCLAREN','McLaren','GB','EUROPE'],['BR-LOTUS','Lotus','GB','EUROPE'],
  ['BR-JAGUAR','Jaguar','GB','EUROPE'],['BR-LAND-ROVER','Land Rover','GB','EUROPE'],['BR-MINI','MINI','GB','EUROPE'],
  ['BR-VAUXHALL','Vauxhall','GB','EUROPE'],['BR-LADA','Lada','RU','EUROPE'],['BR-FORD','Ford','US','AMERIQUE'],
  ['BR-CHEVROLET','Chevrolet','US','AMERIQUE'],['BR-GMC','GMC','US','AMERIQUE'],['BR-CADILLAC','Cadillac','US','AMERIQUE'],
  ['BR-LINCOLN','Lincoln','US','AMERIQUE'],['BR-BUICK','Buick','US','AMERIQUE'],['BR-DODGE','Dodge','US','AMERIQUE'],
  ['BR-CHRYSLER','Chrysler','US','AMERIQUE'],['BR-JEEP','Jeep','US','AMERIQUE'],['BR-RAM','Ram','US','AMERIQUE'],
  ['BR-TESLA','Tesla','US','AMERIQUE'],['BR-RIVIAN','Rivian','US','AMERIQUE'],['BR-LUCID','Lucid Motors','US','AMERIQUE'],
  ['BR-TOYOTA','Toyota','JP','ASIE'],['BR-LEXUS','Lexus','JP','ASIE'],['BR-HONDA','Honda','JP','ASIE'],
  ['BR-ACURA','Acura','JP','ASIE'],['BR-NISSAN','Nissan','JP','ASIE'],['BR-INFINITI','Infiniti','JP','ASIE'],
  ['BR-MAZDA','Mazda','JP','ASIE'],['BR-SUBARU','Subaru','JP','ASIE'],['BR-MITSUBISHI','Mitsubishi','JP','ASIE'],
  ['BR-SUZUKI','Suzuki','JP','ASIE'],['BR-DAIHATSU','Daihatsu','JP','ASIE'],['BR-ISUZU','Isuzu','JP','ASIE'],
  ['BR-HYUNDAI','Hyundai','KR','ASIE'],['BR-KIA','Kia','KR','ASIE'],['BR-GENESIS','Genesis','KR','ASIE'],
  ['BR-SSANGYONG','SsangYong','KR','ASIE'],['BR-TATA','Tata','IN','ASIE'],['BR-MAHINDRA','Mahindra','IN','ASIE'],
  ['BR-BYD','BYD','CN','CHINE'],['BR-NIO','NIO','CN','CHINE'],['BR-XPENG','XPeng','CN','CHINE'],
  ['BR-LI-AUTO','Li Auto','CN','CHINE'],['BR-ZEEKR','Zeekr','CN','CHINE'],['BR-GEELY','Geely','CN','CHINE'],
  ['BR-CHERY','Chery','CN','CHINE'],['BR-OMODA','Omoda','CN','CHINE'],['BR-JAECCOO','Jaecoo','CN','CHINE'],
  ['BR-JETOUR','Jetour','CN','CHINE'],['BR-GREAT-WALL','Great Wall Motor','CN','CHINE'],['BR-HAVAL','Haval','CN','CHINE'],
  ['BR-TANK','Tank','CN','CHINE'],['BR-WEY','Wey','CN','CHINE'],['BR-MG','MG Motor','CN','CHINE'],
  ['BR-MAXUS','MAXUS','CN','CHINE'],['BR-LEAPMOTOR','Leapmotor','CN','CHINE'],['BR-AVATAR','Avatr','CN','CHINE'],
  ['BR-DEEPAL','Deepal','CN','CHINE'],['BR-HONGQI','Hongqi','CN','CHINE'],['BR-BAIC','BAIC','CN','CHINE'],
  ['BR-BEIJING','Beijing Auto','CN','CHINE'],['BR-DONGFENG','Dongfeng','CN','CHINE'],['BR-FOTON','Foton','CN','CHINE'],
  ['BR-GAC','GAC','CN','CHINE'],['BR-TRUMPCHI','Trumpchi','CN','CHINE'],['BR-LYNK-CO','Lynk & Co','CN','CHINE'],
  ['BR-SINOTRUK','Sinotruk','CN','CHINE']
];

const MODELS_RAW = {
  'BR-RENAULT':['Clio','Megane','Scenic','Captur','Arkana','Austral','Rafale','Espace','Talisman','Trafic','Master','Kangoo','Twingo','Zoe','5','4','Express'],
  'BR-PEUGEOT':['208','2008','308','3008','508','5008','Partner','Expert','Traveller','Rifter','Boxer','e-208','e-2008','e-3008','e-408'],
  'BR-CITROEN':['C3','C3 Aircross','C4','C4 Cactus','C4 X','C5 Aircross','Berlingo','Jumpy','Jumper','E-C3','E-C4','E-Jumpy'],
  'BR-DS':['DS 3','DS 4','DS 7','DS 9'],
  'BR-ALPINE':['A110','A290'],
  'BR-BUGATTI':['Chiron','Veyron'],
  'BR-AIXAM':['A510','City G'],
  'BR-LIGIER':['JS50','Nova'],
  'BR-MICROCAR':['M.Go'],
  'BR-VOLKSWAGEN':['Polo','Golf','Passat','Tiguan','Touareg','T-Roc','T-Cross','Taigo','ID.3','ID.4','ID.5','ID.7','Transporter','Crafter','Caddy','Arteon','Up!','Amarok'],
  'BR-AUDI':['A1','A3','A4','A5','A6','A7','A8','Q2','Q3','Q4 e-tron','Q5','Q6 e-tron','Q7','Q8','e-tron','e-tron GT','TT','RS 6'],
  'BR-BMW':['Serie 1','Serie 2','Serie 3','Serie 4','Serie 5','Serie 7','X1','X2','X3','X4','X5','X6','X7','i3','i4','i5','i7','iX','M2','M3','M4','M5','Z4'],
  'BR-MERCEDES-BENZ':['Classe A','Classe B','Classe C','Classe E','Classe S','CLA','CLS','GLA','GLB','GLC','GLE','GLS','EQA','EQB','EQC','EQE','EQS','EQV','Vito','Sprinter','G-Class','AMG GT'],
  'BR-PORSCHE':['911','718 Cayman','718 Boxster','Macan','Cayenne','Panamera','Taycan'],
  'BR-OPEL':['Corsa','Astra','Mokka','Crossland','Grandland','Vivaro','Zafira','Frontera'],
  'BR-SMART':['Fortwo','Forfour','#1','#3'],
  'BR-MAN':['TGS','TGX','TGM'],
  'BR-ALPINA':['B3','B4','B5','XB7'],
  'BR-FIAT':['500','Panda','Tipo','500X','500L','Ducato','Doblo','Freemont'],
  'BR-FERRARI':['Roma','Portofino','SF90 Stradale','296 GTB','Purosangue'],
  'BR-LAMBORGHINI':['Huracan','Urus','Revuelto'],
  'BR-MASERATI':['Ghibli','Levante','MC20','Grecale'],
  'BR-PAGANI':['Huayra','Utopia'],
  'BR-ALFA-ROMEO':['Giulia','Stelvio','Tonale','MiTo'],
  'BR-LANCIA':['Ypsilon','Delta'],
  'BR-IVECO':['Daily','Eurocargo','S-Way'],
  'BR-SEAT':['Ibiza','Leon','Ateca','Arona','Tarraco','El Born','Toledo'],
  'BR-CUPRA':['Formentor','Leon','Born','Tavascan'],
  'BR-SKODA':['Fabia','Octavia','Superb','Kamiq','Karoq','Kodiaq','Enyaq','Scala'],
  'BR-DACIA':['Sandero','Duster','Jogger','Spring','Logan'],
  'BR-VOLVO':['XC40','XC60','XC90','S60','S90','V60','V90','C40','EX30','EX90'],
  'BR-POLESTAR':['Polestar 2','Polestar 3','Polestar 4'],
  'BR-KOENIGSEGG':['Gemera','Jesko'],
  'BR-ASTON-MARTIN':['Vantage','DB12','DBX'],
  'BR-MCLAREN':['Artura','750S','GT'],
  'BR-LOTUS':['Emira','Eletre','Emeya'],
  'BR-JAGUAR':['F-Pace','E-Pace','I-Pace','XF','XE'],
  'BR-LAND-ROVER':['Defender','Discovery','Range Rover','Range Rover Sport','Range Rover Evoque','Velar'],
  'BR-MINI':['Cooper','Countryman','Clubman','Aceman','Convertible'],
  'BR-VAUXHALL':['Corsa','Astra','Mokka','Crossland','Grandland'],
  'BR-LADA':['Vesta','Largus','Niva'],
  'BR-FORD':['Fiesta','Focus','Puma','Kuga','Explorer','Mustang Mach-E','Transit','Ranger','Bronco','F-150'],
  'BR-CHEVROLET':['Spark','Cruze','Malibu','Equinox','Traverse','Tahoe','Suburban','Silverado 1500','Colorado','Bolt EV','Blazer'],
  'BR-GMC':['Sierra 1500','Yukon','Acadia','Terrain','Hummer EV'],
  'BR-CADILLAC':['CT4','CT5','Escalade','Lyriq','XT4','XT5','XT6'],
  'BR-LINCOLN':['Navigator','Aviator','Corsair','Nautilus'],
  'BR-BUICK':['Enclave','Encore GX','Envista'],
  'BR-DODGE':['Challenger','Charger','Durango','Grand Caravan','Hornet'],
  'BR-CHRYSLER':['Pacifica','Voyager'],
  'BR-JEEP':['Wrangler','Cherokee','Grand Cherokee','Compass','Renegade','Gladiator','Wagoneer'],
  'BR-RAM':['Ram 1500','Ram 2500','Ram 3500','ProMaster'],
  'BR-TESLA':['Model 3','Model Y','Model S','Model X','Cybertruck'],
  'BR-RIVIAN':['R1T','R1S'],
  'BR-LUCID':['Air','Gravity'],
  'BR-TOYOTA':['Yaris','Corolla','Camry','Prius','RAV4','C-HR','Hilux','Land Cruiser','GR86','Supra','bZ4X','Aygo X','Proace','HiAce'],
  'BR-LEXUS':['UX','NX','RX','IS','ES','LS','LC','LM','RZ'],
  'BR-HONDA':['Civic','Accord','CR-V','HR-V','Jazz','City','Pilot','Passport','Ridgeline','Prologue'],
  'BR-ACURA':['MDX','RDX','TLX',' Integra'],
  'BR-NISSAN':['Micra','Juke','Qashqai','X-Trail','Leaf','Ariya','Navara','Patrol','GT-R','Z'],
  'BR-INFINITI':['Q50','Q60','QX50','QX55','QX60','QX80'],
  'BR-MAZDA':['Mazda2','Mazda3','Mazda6','CX-3','CX-30','CX-5','CX-60','MX-5'],
  'BR-SUBARU':['Impreza','Legacy','Outback','Forester','Crosstrek','Solterra','WRX','BRZ'],
  'BR-MITSUBISHI':['Space Star','ASX','Eclipse Cross','Outlander','L200','Attrage'],
  'BR-SUZUKI':['Swift','Ignis','Vitara','S-Cross','Jimny','Baleno','Across'],
  'BR-DAIHATSU':['Rocky','Sirion','Cuore'],
  'BR-ISUZU':['D-Max','mu-X','N-Series'],
  'BR-HYUNDAI':['i10','i20','i30','Bayon','Kona','Tucson','Santa Fe','Ioniq 5','Ioniq 6','Ioniq 9','Staria','H-1'],
  'BR-KIA':['Picanto','Rio','Ceed','Stonic','XCeed','Sportage','Sorento','EV6','EV9','Niro','Carnival','K5'],
  'BR-GENESIS':['G70','G80','G90','GV60','GV70','GV80'],
  'BR-SSANGYONG':['Korando','Torres','Rexton'],
  'BR-TATA':['Tiago','Altroz','Nexon'],
  'BR-MAHINDRA':['XUV700','Scorpio-N','Thar'],
  'BR-BYD':['Atto 3','Dolphin','Seal','Han','Tang','Yuan Plus','Seagull'],
  'BR-NIO':['ET5','ET7','ES6','ES7','ES8','EC6','EC7'],
  'BR-XPENG':['P7','P5','G6','G9','X9'],
  'BR-LI-AUTO':['L7','L8','L9','MEGA'],
  'BR-ZEEKR':['001','009','X'],
  'BR-GEELY':['Coolray','Emgrand','Monjaro','Galaxy L7'],
  'BR-CHERY':['Tiggo 4','Tiggo 7','Tiggo 8','Arrizo 8'],
  'BR-OMODA':['Omoda 5','Omoda 7'],
  'BR-JAECCOO':['Jaecoo 7','Jaecoo 8'],
  'BR-JETOUR':['Dashing','T2'],
  'BR-GREAT-WALL':['Poer','Cannon'],
  'BR-HAVAL':['H6','Jolion','Dargo'],
  'BR-TANK':['Tank 300','Tank 500','Tank 700'],
  'BR-WEY':['80','07'],
  'BR-MG':['MG3','MG4','MG5','MG ZS','MG HS','Cyberster'],
  'BR-MAXUS':['eDeliver 3','eDeliver 9','T60','Mifa 9'],
  'BR-LEAPMOTOR':['T03','C10','C11'],
  'BR-AVATAR':['11','12'],
  'BR-DEEPAL':['SL03','S07'],
  'BR-HONGQI':['E-HS9','HQ9'],
  'BR-BAIC':['BJ40','EU5'],
  'BR-BEIJING':['X7','EU5'],
  'BR-DONGFENG':['Forthing T5','Aeolus','Voyah Free'],
  'BR-FOTON':['Tunland','View CS2'],
  'BR-GAC':['Aion Y','Aion S','Empow'],
  'BR-TRUMPCHI':['GS3','GS4','GS8'],
  'BR-LYNK-CO':['01','02','03','06','09'],
  'BR-SINOTRUK':['HOWO TX','HOWO MAX']
};

const ENGINE_TEMPLATES = [
  ['Essence atmosphérique',1000,75,'ESSENCE'],
  ['Essence turbocompressé',1500,130,'ESSENCE'],
  ['Essence performance',2000,220,'ESSENCE'],
  ['Diesel',1600,115,'DIESEL'],
  ['Diesel HD',2000,180,'DIESEL'],
  ['Hybride',1800,140,'HYBRID'],
  ['Hybride rechargeable',2000,218,'PHEV'],
  ['Électrique',0,150,'ELECTRIC'],
  ['Électrique performance',0,300,'ELECTRIC'],
  ['GPL / Éthanol',1400,90,'GPL'],
  ['Mild-Hybrid',1500,130,'MILD-HYBRID']
];

const DTC_RAW = [
  ['P0100','Circuit débitmètre d’air (MAF) - Dysfonctionnement','MAF défectueux, filtre encrassé, fuite admission, câblage','Nettoyer/remplacer MAF, vérifier filtre et durites, tester faisceau','medium'],
  ['P0101','Circuit MAF - Plage hors limites','MAF sale, fuite vide, papillon encrassé','Nettoyer MAF, rechercher fuite, nettoyer papillon','medium'],
  ['P0102','Circuit MAF - Entrée basse','MAF HS, court-circuit, connecteur oxydé','Remplacer MAF, réparer câblage','medium'],
  ['P0103','Circuit MAF - Entrée haute','MAF défaillant, circuit ouvert, 5V anormal','Remplacer MAF, vérifier alimentation','medium'],
  ['P0110','Circuit température air admission (IAT)','Capteur IAT HS, câblage, connecteur','Remplacer IAT, inspecter câblage','low'],
  ['P0115','Circuit température liquide (ECT)','Capteur ECT HS, niveau bas, câblage','Remplacer ECT, vérifier liquide','high'],
  ['P0120','Circuit capteur position papillon (TPS)','TPS HS, câblage, papillon usé','Remplacer TPS, réparer faisceau','high'],
  ['P0125','Température liquide insuffisante pour boucle fermée','Thermostat bloqué ouvert, ECT HS','Remplacer thermostat, vérifier ECT','medium'],
  ['P0130','Circuit sonde lambda B1S1','Sonde HS, câblage brûlé, fuite échappement','Remplacer sonde, réparer faisceau','medium'],
  ['P0131','Sonde lambda B1S1 - Signal bas','Fuite admission, injecteur bouché, sonde HS','Rechercher fuite, tester injecteurs','medium'],
  ['P0132','Sonde lambda B1S1 - Signal haut','Injecteur qui fuit, régulateur HS','Tester injecteurs, vérifier pression','medium'],
  ['P0133','Sonde lambda B1S1 - Réponse lente','Sonde vieillissante, contamination','Remplacer sonde','low'],
  ['P0134','Sonde lambda B1S1 - Aucune activité','Sonde HS, câblage coupé','Remplacer sonde, réparer câblage','medium'],
  ['P0135','Circuit chauffage sonde lambda B1S1','Résistance HS, relais, câblage','Remplacer sonde, tester relais','medium'],
  ['P0171','Système trop pauvre (Banque 1)','Fuite admission, MAF sale, injecteurs, pompe faible','Test fumigène, nettoyer MAF, tester pression','high'],
  ['P0172','Système trop riche (Banque 1)','Injecteurs qui fuient, régulateur HS, filtre encrassé','Tester injecteurs, vérifier pression','high'],
  ['P0174','Système trop pauvre (Banque 2)','Fuite admission B2, MAF sale, injecteurs','Rechercher fuite, nettoyer MAF','high'],
  ['P0200','Circuit injecteur','Injecteur HS, câblage, driver ECU','Tester injecteur, réparer câblage','high'],
  ['P0201','Circuit injecteur cylindre 1','Injecteur cyl.1, câblage, connecteur','Permuter injecteur, tester câblage','high'],
  ['P0300','Ratés d’allumage aléatoires/multiples','Bougies, bobines, injecteurs, fuite, compression, CKP','Remplacer bougies, tester bobines/injecteurs, compression','critical'],
  ['P0301','Ratés cylindre 1','Bougie, bobine, injecteur ou compression cyl.1','Permuter composants, tester compression','critical'],
  ['P0302','Ratés cylindre 2','Bougie, bobine, injecteur ou compression cyl.2','Permuter composants, tester compression','critical'],
  ['P0303','Ratés cylindre 3','Bougie, bobine, injecteur ou compression cyl.3','Permuter composants, tester compression','critical'],
  ['P0304','Ratés cylindre 4','Bougie, bobine, injecteur ou compression cyl.4','Permuter composants, tester compression','critical'],
  ['P0325','Circuit capteur cliquetis','Capteur knock HS, câblage, serrage','Remplacer capteur, vérifier câblage','medium'],
  ['P0335','Circuit capteur vilebrequin (CKP)','Capteur CKP HS, cible, câblage','Remplacer CKP, inspecter cible','critical'],
  ['P0340','Circuit capteur arbre à cames B1','Capteur CMP HS, câblage, distribution','Remplacer CMP, vérifier distribution','critical'],
  ['P0350','Circuit bobine d’allumage','Bobine HS, câblage, bougie','Remplacer bobine, tester bougies','high'],
  ['P0400','Circuit EGR','Vanne EGR bloquée, solénoïde, conduits','Nettoyer/remplacer EGR','medium'],
  ['P0401','Flux EGR insuffisant','EGR bloquée, conduits encrassés','Nettoyer vanne et conduits','medium'],
  ['P0420','Efficacité catalyseur sous seuil B1','Catalyseur HS, sonde, fuite, huile','Tester sondes, vérifier fuites','high'],
  ['P0440','Circuit EVAP','Bouchon, fuite EVAP, vanne purge','Vérifier bouchon, test fumigène','low'],
  ['P0442','Petite fuite EVAP','Bouchon desserré, durite percée','Serrer/remplacer bouchon','low'],
  ['P0443','Circuit vanne purge EVAP','Vanne HS, câblage','Remplacer vanne','low'],
  ['P0446','Circuit ventilation EVAP','Vanne ventilation, canister','Remplacer vanne/canister','low'],
  ['P0455','Fuite importante EVAP','Bouchon manquant, durite débranchée','Vérifier bouchon, inspecter durites','medium'],
  ['P0500','Circuit capteur vitesse véhicule','Capteur VSS HS, câblage','Remplacer capteur','medium'],
  ['P0505','Dysfonctionnement contrôle ralenti','IAC HS, papillon encrassé, fuite','Nettoyer papillon, remplacer IAC','medium'],
  ['P0507','Ralenti plus élevé que prévu','Fuite admission, IAC bloqué','Rechercher fuite, nettoyer papillon','medium'],
  ['P0562','Tension système basse','Batterie faible, alternateur, masses','Tester batterie/alternateur, masses','high'],
  ['P0563','Tension système haute','Régulateur HS, surcharge','Tester régulateur/alternateur','high'],
  ['P0600','Liaison série ECU','ECU HS, CAN corrompu','Vérifier CAN, reprogrammer ECU','critical'],
  ['P0601','Checksum mémoire ECU','ECU corrompu, alimentation instable','Reflasher ECU, vérifier batterie','critical'],
  ['P0606','ECU/PCM processeur interne','ECU HS, surchauffe, humidité','Remplacer ECU','critical'],
  ['P0700','Circuit commande boîte','TCM, câblage, solénoïdes, huile BV','Vérifier huile BV, tester TCM','critical'],
  ['P0715','Capteur vitesse entrée turbine BV','Capteur HS, câblage','Remplacer capteur','high'],
  ['P0720','Capteur vitesse sortie BV','Capteur HS, engrenage','Remplacer capteur','high'],
  ['P0750','Solénoïde shift A','Solénoïde HS, huile BV','Remplacer solénoïde, vidanger BV','high'],
  ['P0800','Système boîte transfert','Moteur transfert, capteur, mécanique','Diagnostiquer transfert','high'],
  ['P2002','FAP/DPF efficacité sous seuil','FAP colmaté, capteur différentiel','Régénération, nettoyer/remplacer FAP','high'],
  ['P20EE','Réduction SCR efficacité faible','AdBlue, pompe SCR, capteur NOx','Vérifier AdBlue, SCR','high'],
  ['P2187','Système trop pauvre au ralenti B1','Fuite vide, MAF, injecteurs, pompe','Test fumigène, nettoyer MAF','medium'],
  ['P2188','Système trop riche au ralenti B1','Injecteurs, pression haute, MAF','Tester injecteurs, régulateur','medium'],
  ['P2270','Sonde lambda B1S2 bloquée riche','Sonde HS, injecteur, cata','Remplacer sonde','medium'],
  ['P2271','Sonde lambda B1S2 bloquée pauvre','Sonde HS, fuite','Remplacer sonde','medium'],
  ['P2400','Circuit contrôle EVAP','Vanne EVAP, câblage, ECU','Tester vanne','low'],
  ['P2500','Signal alternateur/L bas','Alternateur HS, régulateur','Tester alternateur','high'],
  ['P2600','Pompe liquide refroidissement ouverte','Pompe électrique HS, relais','Remplacer pompe','high'],
  ['P2700','Solénoïde transmission A','Solénoïde HS, huile BV','Remplacer solénoïde','high'],
  ['P2A00','Sonde lambda B1S1 performance','Sonde lente, fuite','Remplacer sonde','medium'],
  ['P0A00','Convertisseur DC/DC dysfonctionnement','DC/DC HS, fusible HT, câblage HT','Contrôler fusibles HT, tester DC/DC','critical'],
  ['P0A14','Résistance isolement batterie faible','Fuite HT, humidité, câble HS','Test isolement, séchage, remplacement','critical'],
  ['P0A15','Tension batterie trop élevée','SurchARGE, BMS, capteur HS','Vérifier BMS, isoler si danger','critical'],
  ['P0A16','Tension batterie trop basse','Décharge profonde, cellules faibles','Contrôler SOC/SOH, modules','critical'],
  ['P0A17','Température batterie trop élevée','Refroidissement HS, capteur, surcharge','Vérifier pompe/ventilation batterie','critical'],
  ['P0A19','Contacteur batterie dysfonctionnement','Contacteur HS, relais, précharge','Tester contacteurs/relais','critical'],
  ['P0A1A','Refroidissement batterie performance','Pompe HS, liquide bas, capteur débit','Vérifier pompe, niveau, capteurs','high'],
  ['P0A1C','Équilibrage batterie performance','Cellules déséquilibrées, BMS','Équilibrage forcé, modules','high'],
  ['P0AA6','Défaut isolement batterie hybride','Fuite HT, humidité, câble','Test isolement, inspection HT','critical'],
  ['P0C0A','Groupe motopropulseur électrique performance','Moteur électrique, onduleur, capteurs','Diagnostic onduleur/moteur','critical'],
  ['P0CB0','Onduleur moteur performance','IGBT/MOSFET, capteurs courant, refroidissement','Tester onduleur, refroidissement','critical'],
  ['U0100','Perte communication ECM/PCM','ECU HS, CAN, alimentation','Vérifier alimentation/masse, CAN','critical'],
  ['U0121','Perte communication module ABS','ABS HS, CAN, fusible','Tester alimentation ABS, CAN','critical'],
  ['U0155','Perte communication BCM','BCM HS, CAN, humidité','Vérifier BCM, fusibles, CAN','high'],
  ['U0401','Donnée invalide reçue ECM/PCM','ECU corrompu, CAN bruité, codage','Relecture CAN, mise à jour logiciel','high']
];

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function detId(prefix, ...parts) {
  const raw = parts.filter(Boolean).join('|');
  return `${prefix}-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)}`;
}

function buildReference(seedTs) {
  const brands = BRANDS_RAW.map(([id, name, country, region]) => ({
    id, name, country, region, logo_url: null, updated_at: seedTs
  }));

  const models = [];
  const engines = [];

  for (const brand of brands) {
    const genericModelId = `MD-GEN-${brand.id}`;
    models.push({
      id: genericModelId,
      brand_id: brand.id,
      name: `${brand.name} — Gamme générale`,
      years: '1996-2026',
      updated_at: seedTs
    });

    for (const [type, cc, hp, fuel] of ENGINE_TEMPLATES) {
      engines.push({
        id: detId('ENG', genericModelId, type, hp, fuel),
        model_id: genericModelId,
        type,
        displacement_cc: cc,
        power_hp: hp,
        fuel,
        updated_at: seedTs
      });
    }

    const list = MODELS_RAW[brand.id] || [];
    for (const modelName of list) {
      const modelId = `MD-${brand.id}-${slugify(modelName)}`;
      models.push({
        id: modelId,
        brand_id: brand.id,
        name: modelName,
        years: '1996-2026',
        updated_at: seedTs
      });

      for (const [type, cc, hp, fuel] of ENGINE_TEMPLATES) {
        engines.push({
          id: detId('ENG', modelId, type, hp, fuel),
          model_id: modelId,
          type,
          displacement_cc: cc,
          power_hp: hp,
          fuel,
          updated_at: seedTs
        });
      }
    }
  }

  const faults = DTC_RAW.map(([code, description, causes, solutions, severity]) => ({
    id: `DTC-${code}`,
    dtc_code: code,
    description,
    causes,
    solutions,
    severity,
    applicability: 'ALL',
    brand_id: null,
    model_id: null,
    engine_id: null,
    updated_at: seedTs
  }));

  return { brands, models, engines, faults };
}

function defaultElmProfiles() {
  const ts = now();
  return {
    generic_uds: {
      id: 'generic_uds',
      name: 'UDS générique',
      enabled: true,
      transport: 'elm',
      requestTemplate: '6A {address} {data}',
      functionalTemplate: '6A {data}',
      addresses: {
        engine: '7E0',
        transmission: '7E1',
        abs: '7E2',
        airbag: '7E3',
        body: '7E4'
      },
      dids: {
        vin: 'F190',
        calibration: 'F193',
        software: 'F194',
        hardware: 'F195',
        serial: 'F196',
        mileage: 'F180'
      },
      routines: {
        read_data: '0x22',
        write_data: '0x2E',
        routine_start: '0x3101',
        routine_stop: '0x3102',
        routine_results: '0x3103',
        security_request: '0x2701',
        security_send: '0x2702',
        control_dtc_on: '0x8502',
        control_dtc_off: '0x8501'
      },
      updated_at: ts
    },
    engine_adaptations: {
      id: 'engine_adaptations',
      name: 'Adaptations moteur (templates OEM)',
      enabled: true,
      transport: 'elm',
      requestTemplate: '6A {address} {data}',
      addresses: { engine: '7E0' },
      routines: {
        throttle_learn: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Remplacer XXXXXX par routine constructeur.' },
        egr_adaptation: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        turbo_actuator_calibration: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        maf_adaptation: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        dpf_forced_regen: { service: '31', sub: '01', id: 'XXXXXX', warning: 'DANGER : procédure constructeur obligatoire.' }
      },
      updated_at: ts
    },
    transmission_adaptations: {
      id: 'transmission_adaptations',
      name: 'Boîtes TIPTRONIC / EAT6 / EAT8 / DSG',
      enabled: true,
      transport: 'elm',
      requestTemplate: '6A {address} {data}',
      addresses: { transmission: '7E1' },
      routines: {
        tcm_reset_adaptations: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        clutch_adaptation: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        valve_body_calibration: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        learn_shift_points: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' }
      },
      updated_at: ts
    },
    chassis_safety: {
      id: 'chassis_safety',
      name: 'ABS / ESP / Airbag',
      enabled: true,
      transport: 'elm',
      requestTemplate: '6A {address} {data}',
      addresses: { abs: '7E2', airbag: '7E3' },
      routines: {
        abs_pump_test: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        steering_angle_zero: { service: '31', sub: '01', id: 'XXXXXX', warning: 'Routine OEM requise.' },
        airbag_crash_data_reset: { service: '31', sub: '01', id: 'XXXXXX', warning: 'DANGER : uniquement technicien habilité.' }
      },
      updated_at: ts
    }
  };
}

function seedDb() {
  const ts = now();
  const reference = buildReference(ts);
  const vapid = webPush.generateVAPIDKeys();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  return {
    meta: {
      app_version: '4.0.0',
      data_version: 1,
      last_data_update: ts,
      last_import_at: ts,
      jwt_secret: crypto.randomBytes(48).toString('hex'),
      vapid
    },
    security: {
      private_key_pem: privateKey,
      public_key_spki_b64: Buffer.from(publicKey).toString('base64'),
      key_id: crypto.createHash('sha256').update(Buffer.from(publicKey).toString('base64')).digest('hex').slice(0, 16)
    },
    settings: {
      background: {
        enabled: false,
        type: 'image',
        url: '',
        opacity: 0.22,
        blur: 0,
        overlay: 0.45,
        fit: 'cover',
        applyToGuests: true,
        updated_at: ts
      }
    },
    devices: {},
    access_requests: {},
    push_subscriptions: {},
    audit: [],
    reference,
    workshop: {},
    elm_profiles: defaultElmProfiles(),
    elm_logs: []
  };
}

let db = null;
let saveTimer = null;

function loadDbSync() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!parsed.elm_profiles) parsed.elm_profiles = defaultElmProfiles();
      if (!parsed.settings?.background) parsed.settings.background = seedDb().settings.background;
      if (!parsed.security) parsed.security = seedDb().security;
      return parsed;
    }
  } catch (err) {
    console.error('DB corrompue, reseed:', err);
  }
  const seeded = seedDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2));
  return seeded;
}

function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}

function bumpDataVersion() {
  db.meta.data_version = Number(db.meta.data_version || 1) + 1;
  db.meta.last_data_update = now();
  saveDb();
  return db.meta.data_version;
}

function logAudit({ deviceId = null, actor = 'system', action, details = null }) {
  const rec = { id: uid(), ts: now(), deviceId, actor, action, details };
  db.audit.unshift(rec);
  db.audit = db.audit.slice(0, 1000);
  saveDb();
  return rec;
}

db = loadDbSync();

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@diagauto.local',
  db.meta.vapid.publicKey,
  db.meta.vapid.privateKey
);

function signToken(payload, expiresIn = '180d') {
  return jwt.sign(payload, db.meta.jwt_secret, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, db.meta.jwt_secret);
}

function signOwnerToken() {
  return signToken({ deviceId: 'owner', role: 'owner' }, '365d');
}

function signGuestToken(deviceId, role = 'guest') {
  return signToken({ deviceId, role }, '180d');
}

function signActionToken(requestId, action) {
  return signToken({ requestId, action, kind: 'access-action' }, '60d');
}

function verifyActionToken(token) {
  const decoded = jwt.verify(token, db.meta.jwt_secret);
  if (decoded.kind !== 'access-action') throw new Error('Invalid action token');
  return decoded;
}

function auth(required = true, roles = null) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'Authentication required' });
      return next();
    }
    try {
      const decoded = verifyToken(token);
      if (roles && !roles.includes(decoded.role)) return res.status(403).json({ error: 'Role not allowed' });
      if (decoded.role === 'guest') {
        const device = db.devices[decoded.deviceId];
        if (!device || device.status !== 'granted') return res.status(403).json({ error: 'Access revoked or not granted' });
      }
      req.auth = decoded;
      next();
    } catch {
      return res.status(403).json({ error: 'Invalid token' });
    }
  };
}

const requireOwner = auth(true, ['owner']);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '120mb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

const wsClients = new Map();

function wsBroadcast(message, deviceId = null) {
  const data = JSON.stringify(message);
  for (const [id, ws] of wsClients.entries()) {
    if (deviceId && id !== deviceId) continue;
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('deviceId') || uid();
  wsClients.set(deviceId, ws);
  ws.on('close', () => wsClients.delete(deviceId));
  ws.send(JSON.stringify({ type: 'CONNECTED', deviceId }));
});

function publicBackground() {
  const bg = db.settings.background;
  if (!bg?.enabled || !bg.applyToGuests) return null;
  return { ...bg };
}

function ownerBackground() {
  return { ...db.settings.background };
}

function getSubscriptions(role, deviceId) {
  const all = Object.values(db.push_subscriptions || {});
  if (deviceId) return all.filter(s => s.device_id === deviceId);
  return all.filter(s => s.role === role);
}

async function sendPush(subscriptions, payload) {
  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 86400, urgency: 'high' }
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        delete db.push_subscriptions[sub.id];
        saveDb();
      }
    }
  }
}

async function notifyAccessRequest(request) {
  const grantToken = signActionToken(request.id, 'grant');
  const denyToken = signActionToken(request.id, 'deny');
  await sendPush(getSubscriptions('owner'), {
    title: `Demande d'accès de ${request.requester_name}`,
    body: 'Accepter ou refuser en direct.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `access-${request.id}`,
    renotify: true,
    data: {
      type: 'ACCESS_REQUEST',
      requestId: request.id,
      deviceId: request.device_id,
      requesterName: request.requester_name,
      actionTokens: { grant: grantToken, deny: denyToken },
      url: `/?access=${request.id}`
    },
    actions: [
      { action: 'grant', title: '✅ Accepter' },
      { action: 'deny', title: '❌ Refuser' }
    ]
  });
}

async function notifyAccessGranted(deviceId, token, requesterName) {
  await sendPush(getSubscriptions(null, deviceId), {
    title: 'Accès DiagAuto Pro accordé',
    body: `Votre accès a été validé${requesterName ? ', ' + requesterName : ''}.`,
    icon: '/icons/icon-192.png',
    data: { type: 'ACCESS_GRANTED', deviceId, token }
  });
}

async function notifyAccessRevoked(deviceId) {
  await sendPush(getSubscriptions(null, deviceId), {
    title: 'Accès DiagAuto Pro révoqué',
    body: 'Votre accès a été révoqué par le propriétaire.',
    icon: '/icons/icon-192.png',
    data: { type: 'ACCESS_REVOKED', deviceId }
  });
}

function signPayload(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const key = crypto.createPrivateKey({ key: db.security.private_key_pem, format: 'pem' });
  return crypto.sign('sha256', data, key).toString('base64');
}

function buildRevocationPayload() {
  const devices = Object.values(db.devices || {});
  return {
    issued_at: now(),
    expires_at: now() + 30 * 24 * 60 * 60 * 1000,
    data_version: Number(db.meta.data_version || 1),
    revoked_device_ids: devices.filter(d => d.status === 'revoked').map(d => d.id),
    denied_device_ids: devices.filter(d => d.status === 'denied').map(d => d.id)
  };
}

function upsertReferenceItem(collection, item) {
  const arr = db.reference[collection];
  const idx = arr.findIndex(x => x.id === item.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...item, updated_at: now() };
  else arr.push({ ...item, updated_at: now() });
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'DiagAutoPro/4.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function importNhtsaPopular() {
  try {
    console.log('🌐 Import NHTSA populaire démarré...');
    const makes = (await fetchJson('https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json')).Results || [];
    const popular = ['Toyota','Honda','Ford','Chevrolet','BMW','Mercedes-Benz','Audi','Volkswagen','Nissan','Hyundai','Kia','Jeep','Tesla','Subaru','Mazda','Lexus','Porsche','Volvo','Mini','Land Rover','Jaguar','Mitsubishi'];
    const makeMap = new Map(makes.map(m => [m.MakeName, m]));

    for (const makeName of popular) {
      const make = makeMap.get(makeName);
      if (!make) continue;
      const brandId = `BR-NHTSA-${make.MakeId}`;
      upsertReferenceItem('brands', { id: brandId, name: make.MakeName, country: 'US', region: 'AMERIQUE', logo_url: null });

      const models = (await fetchJson(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(makeName)}?format=json`)).Results || [];
      for (const model of models.slice(0, 120)) {
        const modelId = `MD-NHTSA-${model.Model_ID || slugify(model.Model_Name)}`;
        upsertReferenceItem('models', {
          id: modelId,
          brand_id: brandId,
          name: model.Model_Name,
          years: `${model.StartYear || 1996}-${model.EndYear || 2026}`
        });
        for (const [type, cc, hp, fuel] of ENGINE_TEMPLATES) {
          upsertReferenceItem('engines', {
            id: detId('ENG', modelId, type, hp, fuel),
            model_id: modelId,
            type,
            displacement_cc: cc,
            power_hp: hp,
            fuel
          });
        }
      }
      await new Promise(r => setTimeout(r, 120));
    }

    db.meta.last_import_at = now();
    bumpDataVersion();
    console.log('✅ Import NHTSA terminé');
  } catch (err) {
    console.warn('⚠️ Import NHTSA ignoré:', err.message);
  }
}

setInterval(() => {
  const last = Number(db.meta.last_import_at || 0);
  if (now() - last > IMPORT_INTERVAL_MS) importNhtsaPopular();
}, 60 * 60 * 1000);

app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

app.get('/api/version', (req, res) => {
  res.json({
    app_version: db.meta.app_version,
    data_version: Number(db.meta.data_version || 1),
    last_data_update: Number(db.meta.last_data_update || 0),
    server_time: now()
  });
});

app.get('/api/bootstrap', (req, res) => {
  res.json({
    version: Number(db.meta.data_version || 1),
    brands: db.reference.brands,
    models: db.reference.models,
    engines: db.reference.engines,
    faults: db.reference.faults,
    elm_profiles: db.elm_profiles,
    settings: { background: publicBackground() }
  });
});

app.get('/api/settings/public', (req, res) => res.json({ background: publicBackground() }));
app.get('/api/settings/background', requireOwner, (req, res) => res.json({ background: ownerBackground() }));

app.post('/api/settings/background', requireOwner, (req, res) => {
  try {
    const { type, dataUrl, opacity, blur, overlay, fit, applyToGuests, enabled, url } = req.body || {};
    const bg = db.settings.background;

    if (typeof enabled === 'boolean') bg.enabled = enabled;
    if (typeof opacity === 'number') bg.opacity = Math.max(0, Math.min(1, opacity));
    if (typeof blur === 'number') bg.blur = Math.max(0, Math.min(30, blur));
    if (typeof overlay === 'number') bg.overlay = Math.max(0, Math.min(1, overlay));
    if (fit) bg.fit = fit;
    if (typeof applyToGuests === 'boolean') bg.applyToGuests = applyToGuests;

    if (dataUrl && typeof dataUrl === 'string') {
      const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (!match) throw new Error('Data URL invalide');
      const mime = match[1];
      const base64 = match[2];
      const allowed = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm'
      };
      if (!allowed[mime]) throw new Error('Type non autorisé');
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 100 * 1024 * 1024) throw new Error('Fichier trop lourd (max 100 Mo)');
      const filename = `bg-${now()}.${allowed[mime]}`;
      fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
      bg.type = mime.startsWith('image/') ? 'image' : 'video';
      bg.url = `/media/${filename}`;
      bg.enabled = true;
    } else if (typeof url === 'string') {
      bg.url = url;
      bg.type = /\.(mp4|webm)$/i.test(url) ? 'video' : 'image';
    }

    bg.updated_at = now();
    saveDb();
    logAudit({ deviceId: req.auth.deviceId, actor: 'owner', action: 'background_updated', details: { url: bg.url, enabled: bg.enabled } });
    res.json({ success: true, background: ownerBackground() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/owner', (req, res) => {
  const { code } = req.body || {};
  if (code !== OWNER_CODE) return res.status(401).json({ error: 'Code propriétaire invalide' });
  logAudit({ deviceId: 'owner', actor: 'owner', action: 'owner_login', details: { ok: true } });
  res.json({ token: signOwnerToken(), role: 'owner', name: 'Propriétaire' });
});

app.get('/api/auth/me', auth(true), (req, res) => res.json({ auth: req.auth }));

app.get('/api/push/public-key', (req, res) => res.json({ publicKey: db.meta.vapid.publicKey }));

app.post('/api/push/subscribe', (req, res) => {
  const { subscription, deviceId, role } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Subscription invalide' });
  }
  const id = uid();
  db.push_subscriptions[id] = {
    id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    device_id: deviceId || null,
    role: role || 'guest',
    created_at: now()
  };
  saveDb();
  res.json({ success: true });
});

app.post('/api/devices/register', (req, res) => {
  const { deviceId, name, role } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });
  const ts = now();
  db.devices[deviceId] = {
    id: deviceId,
    name: name || db.devices[deviceId]?.name || null,
    role: role || db.devices[deviceId]?.role || 'guest',
    status: db.devices[deviceId]?.status || 'pending',
    created_at: db.devices[deviceId]?.created_at || ts,
    updated_at: ts
  };
  saveDb();
  res.json({ success: true, deviceId });
});

app.post('/api/access/request', async (req, res) => {
  const { deviceId, requesterName, role } = req.body || {};
  if (!deviceId || !requesterName) return res.status(400).json({ error: 'deviceId et requesterName requis' });
  const ts = now();
  const requestId = uid();
  const deviceRole = role || 'guest';

  db.devices[deviceId] = {
    id: deviceId,
    name: requesterName,
    role: deviceRole,
    status: 'pending',
    created_at: db.devices[deviceId]?.created_at || ts,
    updated_at: ts
  };

  const request = {
    id: requestId,
    device_id: deviceId,
    requester_name: requesterName,
    role: deviceRole,
    status: 'pending',
    created_at: ts,
    updated_at: ts
  };

  db.access_requests[requestId] = request;
  saveDb();

  logAudit({ deviceId, actor: requesterName, action: 'access_request', details: { requestId, role: deviceRole } });
  wsBroadcast({ type: 'ACCESS_REQUEST', payload: request });
  await notifyAccessRequest(request).catch(err => console.warn('Push owner échoué:', err.message));

  res.json({ success: true, requestId, status: 'pending' });
});

app.get('/api/access/list', requireOwner, (req, res) => {
  const rows = Object.values(db.access_requests || {})
    .map(r => ({ ...r, device_status: db.devices[r.device_id]?.status || 'unknown' }))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 200);
  res.json(rows);
});

app.get('/api/access/status', (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });
  const device = db.devices[deviceId];
  if (!device) return res.json({ status: 'unknown' });
  const response = { status: device.status, name: device.name, role: device.role };
  if (device.status === 'granted') response.token = signGuestToken(deviceId, device.role || 'guest');
  res.json(response);
});

async function updateAccessStatus(requestId, status, actor = 'owner') {
  const request = db.access_requests[requestId];
  if (!request) throw new Error('Demande introuvable');
  const ts = now();

  request.status = status;
  request.updated_at = ts;
  db.access_requests[requestId] = request;

  if (db.devices[request.device_id]) {
    db.devices[request.device_id].status = status;
    db.devices[request.device_id].updated_at = ts;
  }

  saveDb();
  logAudit({ deviceId: request.device_id, actor, action: `access_${status}`, details: { requestId, requesterName: request.requester_name } });
  wsBroadcast({ type: 'ACCESS_UPDATED', payload: request });

  if (status === 'granted') {
    const token = signGuestToken(request.device_id, request.role || 'guest');
    wsBroadcast({ type: 'ACCESS_GRANTED', deviceId: request.device_id, token }, request.device_id);
    await notifyAccessGranted(request.device_id, token, request.requester_name).catch(err => console.warn('Push guest échoué:', err.message));
  }

  if (status === 'revoked') {
    wsBroadcast({ type: 'ACCESS_REVOKED', deviceId: request.device_id }, request.device_id);
    await notifyAccessRevoked(request.device_id).catch(err => console.warn('Push revoke échoué:', err.message));
  }

  if (status === 'denied') {
    wsBroadcast({ type: 'ACCESS_DENIED', deviceId: request.device_id }, request.device_id);
  }

  return request;
}

app.post('/api/access/update', requireOwner, async (req, res) => {
  const { requestId, status } = req.body || {};
  if (!['granted', 'denied', 'revoked'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  try {
    const updated = await updateAccessStatus(requestId, status, req.auth.deviceId || 'owner');
    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/access/action', async (req, res) => {
  const { requestId, action, actionToken } = req.body || {};
  if (!requestId || !action || !actionToken) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    const decoded = verifyActionToken(actionToken);
    if (decoded.requestId !== requestId || decoded.action !== action) return res.status(403).json({ error: 'Action token invalide' });
    const statusMap = { grant: 'granted', deny: 'denied', revoke: 'revoked' };
    const status = statusMap[action];
    if (!status) return res.status(400).json({ error: 'Action inconnue' });
    const updated = await updateAccessStatus(requestId, status, 'notification');
    res.json({ success: true, request: updated });
  } catch {
    res.status(403).json({ error: 'Token invalide ou expiré' });
  }
});

app.get('/api/security/public-key', (req, res) => {
  res.json({
    kty: 'RSA',
    alg: 'RSASSA-PKCS1-v1_5',
    use: 'sig',
    spki_b64: db.security.public_key_spki_b64,
    key_id: db.security.key_id
  });
});

app.get('/api/security/revocations', (req, res) => {
  const payload = buildRevocationPayload();
  res.json({
    payload,
    signature_b64: signPayload(payload),
    algorithm: 'RSASSA-PKCS1-v1_5-SHA256',
    key_id: db.security.key_id
  });
});

app.get('/api/security/audit', requireOwner, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  res.json(db.audit.slice(0, limit));
});

app.get('/api/sync/delta', auth(true), (req, res) => {
  const since = Number(req.query.since || 0);
  const filter = (arr) => arr.filter(x => Number(x.updated_at || 0) > since);
  res.json({
    since,
    serverVersion: Number(db.meta.data_version || 1),
    brands: filter(db.reference.brands),
    models: filter(db.reference.models),
    engines: filter(db.reference.engines),
    faults: filter(db.reference.faults)
  });
});

app.get('/api/workshop/delta', auth(true), (req, res) => {
  const since = Number(req.query.since || 0);
  const records = Object.values(db.workshop || {}).filter(r => Number(r.updated_at || 0) > since).sort((a,b)=>a.updated_at-b.updated_at);
  res.json({ since, server_time: now(), records });
});

app.post('/api/workshop/push', auth(true), (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records[] requis' });
  let applied = 0;
  for (const rec of records) {
    if (!rec?.id || !['vehicle','intervention'].includes(rec.type)) continue;
    const existing = db.workshop[rec.id];
    const updatedAt = Number(rec.updated_at || now());
    if (!existing || updatedAt >= Number(existing.updated_at || 0)) {
      db.workshop[rec.id] = {
        id: rec.id,
        type: rec.type,
        payload: rec.payload || rec,
        updated_at: updatedAt,
        deleted: !!rec.deleted,
        device_id: rec.device_id || req.auth.deviceId || 'owner',
        author: rec.author || ''
      };
      applied++;
    }
  }
  saveDb();
  logAudit({ deviceId: req.auth.deviceId, actor: req.auth.role, action: 'workshop_push', details: { applied } });
  res.json({ success: true, applied, server_time: now() });
});

app.get('/api/elm/profiles', auth(true), (req, res) => res.json(db.elm_profiles));

app.post('/api/elm/profiles', requireOwner, (req, res) => {
  const profiles = req.body || {};
  if (typeof profiles !== 'object' || Array.isArray(profiles)) return res.status(400).json({ error: 'Objet de profils attendu' });
  db.elm_profiles = profiles;
  saveDb();
  logAudit({ deviceId: req.auth.deviceId, actor: 'owner', action: 'elm_profiles_updated' });
  res.json({ success: true, profiles: db.elm_profiles });
});

app.post('/api/elm/log', auth(true), (req, res) => {
  const { action, command, response, ok } = req.body || {};
  const rec = {
    id: uid(),
    ts: now(),
    deviceId: req.auth.deviceId,
    actor: req.auth.role,
    action: action || 'elm_command',
    command: String(command || '').slice(0, 500),
    response: String(response || '').slice(0, 2000),
    ok: ok !== false
  };
  db.elm_logs.unshift(rec);
  db.elm_logs = db.elm_logs.slice(0, 1000);
  saveDb();
  res.json({ success: true, log: rec });
});

app.get('/api/elm/logs', requireOwner, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  res.json(db.elm_logs.slice(0, limit));
});

app.post('/api/import/trigger', requireOwner, async (req, res) => {
  try {
    logAudit({ deviceId: req.auth.deviceId, actor: 'owner', action: 'import_trigger' });
    await importNhtsaPopular();
    res.json({ success: true, version: db.meta.data_version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(/^(?!\/api|\/media).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 DiagAuto Pro 4.0 : http://localhost:${PORT}`);
  console.log(`🔑 Code propriétaire : ${OWNER_CODE}`);
  if (Number(db.meta.last_import_at || 0) === 0 || now() - Number(db.meta.last_import_at) > IMPORT_INTERVAL_MS) {
    importNhtsaPopular();
  }
});
