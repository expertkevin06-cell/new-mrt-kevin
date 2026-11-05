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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const OWNER_CODE = process.env.OWNER_CODE || 'DIAGAUTO-OWNER';

const now = () => Date.now();
const uid = () => crypto.randomUUID();

const DEFAULT_ELM_PROFILES = {
  version: '4.3.0',
  updated_at: 0,
  legal_notice: 'Base open source d’aide au diagnostic. Les écritures et routines doivent être utilisées uniquement par un professionnel habilité, avec procédures constructeur légales et documentées.',
  safety: {
    owner_only_writes: true,
    require_confirmation_for_dangerous_routines: true,
    require_owner_for_security_access: true,
    require_owner_for_dtc_clear: true,
    require_owner_for_did_write: true,
    require_owner_for_routine_start: true,
    forbidden_without_oem_authorization: [
      'flash_ecu',
      'security_bypass',
      'immobilizer_bypass',
      'odometer_write',
      'airbag_crash_data_reset_without_procedure',
      'emission_system_disable',
      'dpf_delete',
      'egr_delete',
      'adblue_disable',
      'vin_modification'
    ],
    warnings: [
      'Les routines placeholder doivent être remplacées par des IDs OEM documentés.',
      'Le security access UDS nécessite une clé légitime.',
      'Airbag, ABS/ESP, HT, direction et dépollution sont critiques.'
    ]
  },
  transport_defaults: {
    protocol: 6,
    tx_id: '7E0',
    rx_id: '7E8',
    functional_id: '7DF',
    padding: 'CC',
    block_size: 0,
    st_min: 0,
    timeout_ms: 5000,
    max_frame_length: 8
  },
  nrc: {
    '0x10': 'General reject',
    '0x11': 'Service not supported',
    '0x12': 'Sub-function not supported',
    '0x13': 'Incorrect message length or invalid format',
    '0x22': 'Conditions not correct',
    '0x24': 'Request sequence error',
    '0x25': 'No key from output device',
    '0x26': 'Invalid key',
    '0x27': 'Exceed number of attempts',
    '0x28': 'Required time delay not expired',
    '0x31': 'Request out of range',
    '0x33': 'Security access denied',
    '0x35': 'Invalid key',
    '0x36': 'Exceed number of attempts',
    '0x37': 'Required time delay not expired',
    '0x70': 'Upload/download not accepted',
    '0x71': 'Transfer data suspended',
    '0x73': 'General programming failure',
    '0x78': 'Request correctly received - response pending'
  },
  services: {
    '0x10': { name: 'DiagnosticSessionControl', write: false },
    '0x11': { name: 'ECUReset', write: true },
    '0x14': { name: 'ClearDiagnosticInformation', write: true },
    '0x19': { name: 'ReadDTCInformation', write: false },
    '0x22': { name: 'ReadDataByIdentifier', write: false },
    '0x27': { name: 'SecurityAccess', write: true },
    '0x28': { name: 'CommunicationControl', write: true },
    '0x2E': { name: 'WriteDataByIdentifier', write: true },
    '0x31': { name: 'RoutineControl', write: true },
    '0x3E': { name: 'TesterPresent', write: false },
    '0x85': { name: 'ControlDTCSetting', write: true }
  },
  standard_dids: {
    F187: 'Identité véhicule active',
    F188: 'Identité véhicule inactuelle',
    F189: 'Identité véhicule de fabrication',
    F190: 'VIN',
    F191: 'Numéro de pièce',
    F192: 'Numéro de pièce système',
    F193: 'Numéro de calibration système',
    F194: 'Numéro de logiciel système',
    F195: 'Numéro de matériel système',
    F196: 'Numéro de système',
    F197: 'Repair shop',
    F198: 'Date de fabrication'
  },
  brands: {
    'BR-RENAULT': { name: 'Renault', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-PEUGEOT': { name: 'Peugeot', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-CITROEN': { name: 'Citroën', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-DS': { name: 'DS Automobiles', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-DACIA': { name: 'Dacia', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-VOLKSWAGEN': { name: 'Volkswagen', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-AUDI': { name: 'Audi', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-SKODA': { name: 'Škoda', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-SEAT': { name: 'SEAT', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-BMW': { name: 'BMW', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-MERCEDES-BENZ': { name: 'Mercedes-Benz', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-PORSCHE': { name: 'Porsche', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-FORD': { name: 'Ford', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-TOYOTA': { name: 'Toyota', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-HONDA': { name: 'Honda', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-NISSAN': { name: 'Nissan', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-HYUNDAI': { name: 'Hyundai', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-KIA': { name: 'Kia', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-VOLVO': { name: 'Volvo', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-TESLA': { name: 'Tesla', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-BYD': { name: 'BYD', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' },
    'BR-MG': { name: 'MG Motor', protocol: 'CAN', tx_id: '7E0', rx_id: '7E8' }
  },
  ecu_groups: [
    {
      id: 'ENGINE_GENERIC',
      name: 'Calculateur moteur générique UDS',
      category: 'MOTEUR',
      tx_id: '7E0',
      rx_id: '7E8',
      dids: ['F190', 'F191', 'F193', 'F194', 'F195'],
      variables: [
        { name: 'Régime moteur', source: 'pid', pid: '010C', unit: 'tr/min', confirmed: true },
        { name: 'Vitesse véhicule', source: 'pid', pid: '010D', unit: 'km/h', confirmed: true },
        { name: 'Température liquide', source: 'pid', pid: '0105', unit: '°C', confirmed: true },
        { name: 'Charge moteur', source: 'pid', pid: '0104', unit: '%', confirmed: true },
        { name: 'Position papillon', source: 'pid', pid: '0111', unit: '%', confirmed: true },
        { name: 'Tension système', source: 'pid', pid: '0142', unit: 'V', confirmed: true },
        { name: 'STFT banque 1', source: 'pid', pid: '0106', unit: '%', confirmed: true },
        { name: 'LTFT banque 1', source: 'pid', pid: '0107', unit: '%', confirmed: true },
        { name: 'Pression rail (exemple DID)', source: 'did', did: 'F467', byte_offset: 0, length: 2, scale: 0.1, offset: 0, signed: false, unit: 'bar', confirmed: false }
      ],
      routines: [
        { id: 'THROTTLE_LEARN', name: 'Apprentissage boîtier papillon', service: '31', routine_id: '000000', requires_owner: true, danger: false, placeholder: true, warning: 'Routine OEM requise.' },
        { id: 'EGR_ADAPTATION', name: 'Adaptation vanne EGR', service: '31', routine_id: '000000', requires_owner: true, danger: false, placeholder: true, warning: 'Routine OEM requise.' },
        { id: 'DPF_FORCED_REGEN', name: 'Régénération forcée FAP/DPF', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'DANGER : procédure constructeur obligatoire.' }
      ]
    },
    {
      id: 'TRANSMISSION_GENERIC',
      name: 'Boîte de vitesses générique UDS',
      category: 'TRANSMISSION',
      tx_id: '7E1',
      rx_id: '7E9',
      dids: ['F190', 'F191', 'F194', 'F195'],
      variables: [
        { name: 'Vitesse véhicule', source: 'pid', pid: '010D', unit: 'km/h', confirmed: true },
        { name: 'Rapport (exemple DID)', source: 'did', did: 'F469', byte_offset: 0, length: 1, scale: 1, offset: 0, signed: false, unit: '', confirmed: false },
        { name: 'Température huile BV (exemple DID)', source: 'did', did: 'F46A', byte_offset: 0, length: 1, scale: 1, offset: -40, signed: false, unit: '°C', confirmed: false }
      ],
      routines: [
        { id: 'TCM_RESET_ADAPTATIONS', name: 'Réinitialisation adaptations TCM', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'Routine OEM requise.' },
        { id: 'CLUTCH_ADAPTATION', name: 'Apprentissage embrayage', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'Routine OEM requise.' }
      ]
    },
    {
      id: 'ABS_ESP_GENERIC',
      name: 'ABS / ESP générique UDS',
      category: 'CHASSIS',
      tx_id: '7E2',
      rx_id: '7EA',
      dids: ['F190', 'F191', 'F194', 'F195'],
      variables: [
        { name: 'Angle volant (exemple DID)', source: 'did', did: 'F474', byte_offset: 0, length: 2, scale: 0.1, offset: -3276.8, signed: true, unit: '°', confirmed: false },
        { name: 'Vitesse roue AVG (exemple DID)', source: 'did', did: 'F470', byte_offset: 0, length: 2, scale: 0.056, offset: 0, signed: false, unit: 'km/h', confirmed: false }
      ],
      routines: [
        { id: 'ABS_PUMP_TEST', name: 'Test pompe ABS', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'Routine OEM requise.' },
        { id: 'STEERING_ANGLE_ZERO', name: 'Zero angle volant', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'Roues droites obligatoires.' }
      ]
    },
    {
      id: 'AIRBAG_SRS_GENERIC',
      name: 'Airbag / SRS générique UDS',
      category: 'SECURITE',
      tx_id: '7E3',
      rx_id: '7EB',
      dids: ['F190', 'F191', 'F194', 'F195'],
      variables: [
        { name: 'Crash data (exemple DID)', source: 'did', did: 'F480', byte_offset: 0, length: 1, scale: 1, offset: 0, signed: false, unit: '', enum: { 0: 'Aucune', 1: 'Présente', 2: 'Lue' }, confirmed: false }
      ],
      routines: [
        { id: 'AIRBAG_CRASH_DATA_READ', name: 'Lecture crash data', service: '31', routine_id: '000000', requires_owner: true, danger: false, placeholder: true, warning: 'Lecture seulement.' },
        { id: 'AIRBAG_CRASH_DATA_RESET', name: 'Reset crash data', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'DANGER : technicien habilité uniquement.' }
      ]
    },
    {
      id: 'HV_BATTERY_GENERIC',
      name: 'Batterie HT / BMS générique UDS',
      category: 'ELECTRIQUE',
      tx_id: '7E5',
      rx_id: '7ED',
      dids: ['F190', 'F191', 'F194', 'F195'],
      variables: [
        { name: 'SOC batterie HT (exemple DID)', source: 'did', did: 'F4A0', byte_offset: 0, length: 1, scale: 0.5, offset: 0, signed: false, unit: '%', confirmed: false },
        { name: 'SOH batterie HT (exemple DID)', source: 'did', did: 'F4A1', byte_offset: 0, length: 1, scale: 0.5, offset: 0, signed: false, unit: '%', confirmed: false },
        { name: 'Tension batterie HT (exemple DID)', source: 'did', did: 'F4A2', byte_offset: 0, length: 2, scale: 0.1, offset: 0, signed: false, unit: 'V', confirmed: false },
        { name: 'Isolement HT (exemple DID)', source: 'did', did: 'F4A5', byte_offset: 0, length: 2, scale: 1, offset: 0, signed: false, unit: 'kΩ/V', confirmed: false }
      ],
      routines: [
        { id: 'INSULATION_TEST', name: 'Test isolement HT', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'DANGER HT : habilitation obligatoire.' },
        { id: 'BATTERY_BALANCING', name: 'Équilibrage batterie HT', service: '31', routine_id: '000000', requires_owner: true, danger: true, placeholder: true, warning: 'Procédure constructeur obligatoire.' }
      ]
    }
  ]
};

const BRANDS_RAW = [
  ['BR-RENAULT', 'Renault', 'FR', 'EUROPE'],
  ['BR-PEUGEOT', 'Peugeot', 'FR', 'EUROPE'],
  ['BR-CITROEN', 'Citroën', 'FR', 'EUROPE'],
  ['BR-DS', 'DS Automobiles', 'FR', 'EUROPE'],
  ['BR-DACIA', 'Dacia', 'RO', 'EUROPE'],
  ['BR-VOLKSWAGEN', 'Volkswagen', 'DE', 'EUROPE'],
  ['BR-AUDI', 'Audi', 'DE', 'EUROPE'],
  ['BR-SKODA', 'Škoda', 'CZ', 'EUROPE'],
  ['BR-SEAT', 'SEAT', 'ES', 'EUROPE'],
  ['BR-BMW', 'BMW', 'DE', 'EUROPE'],
  ['BR-MERCEDES-BENZ', 'Mercedes-Benz', 'DE', 'EUROPE'],
  ['BR-PORSCHE', 'Porsche', 'DE', 'EUROPE'],
  ['BR-FORD', 'Ford', 'US', 'AMERIQUE'],
  ['BR-CHEVROLET', 'Chevrolet', 'US', 'AMERIQUE'],
  ['BR-JEEP', 'Jeep', 'US', 'AMERIQUE'],
  ['BR-TESLA', 'Tesla', 'US', 'AMERIQUE'],
  ['BR-TOYOTA', 'Toyota', 'JP', 'ASIE'],
  ['BR-LEXUS', 'Lexus', 'JP', 'ASIE'],
  ['BR-HONDA', 'Honda', 'JP', 'ASIE'],
  ['BR-NISSAN', 'Nissan', 'JP', 'ASIE'],
  ['BR-MAZDA', 'Mazda', 'JP', 'ASIE'],
  ['BR-SUBARU', 'Subaru', 'JP', 'ASIE'],
  ['BR-MITSUBISHI', 'Mitsubishi', 'JP', 'ASIE'],
  ['BR-SUZUKI', 'Suzuki', 'JP', 'ASIE'],
  ['BR-HYUNDAI', 'Hyundai', 'KR', 'ASIE'],
  ['BR-KIA', 'Kia', 'KR', 'ASIE'],
  ['BR-VOLVO', 'Volvo', 'SE', 'EUROPE'],
  ['BR-BYD', 'BYD', 'CN', 'CHINE'],
  ['BR-MG', 'MG Motor', 'CN', 'CHINE'],
  ['BR-GEELY', 'Geely', 'CN', 'CHINE'],
  ['BR-CHERY', 'Chery', 'CN', 'CHINE'],
  ['BR-GREAT-WALL', 'Great Wall Motor', 'CN', 'CHINE']
];

const MODELS_RAW = {
  'BR-RENAULT': ['Clio', 'Megane', 'Captur', 'Scenic', 'Talisman', 'Austral', 'Rafale', 'Trafic', 'Master', 'Zoe', '5', '4'],
  'BR-PEUGEOT': ['208', '2008', '308', '3008', '508', '5008', 'Partner', 'Expert', 'Boxer', 'e-208', 'e-3008'],
  'BR-CITROEN': ['C3', 'C3 Aircross', 'C4', 'C5 Aircross', 'Berlingo', 'Jumpy', 'E-C3', 'E-C4'],
  'BR-DS': ['DS 3', 'DS 4', 'DS 7', 'DS 9'],
  'BR-DACIA': ['Sandero', 'Duster', 'Jogger', 'Spring', 'Logan'],
  'BR-VOLKSWAGEN': ['Polo', 'Golf', 'Passat', 'Tiguan', 'Touareg', 'T-Roc', 'ID.3', 'ID.4', 'ID.5', 'Transporter', 'Caddy'],
  'BR-AUDI': ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron'],
  'BR-SKODA': ['Fabia', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq'],
  'BR-SEAT': ['Ibiza', 'Leon', 'Ateca', 'Arona', 'Tarraco', 'Born'],
  'BR-BMW': ['Serie 1', 'Serie 3', 'Serie 5', 'Serie 7', 'X1', 'X3', 'X5', 'X7', 'i4', 'iX', 'M3', 'M5'],
  'BR-MERCEDES-BENZ': ['Classe A', 'Classe C', 'Classe E', 'Classe S', 'GLA', 'GLC', 'GLE', 'GLS', 'EQA', 'EQE', 'EQS', 'Sprinter'],
  'BR-PORSCHE': ['911', '718 Cayman', 'Macan', 'Cayenne', 'Panamera', 'Taycan'],
  'BR-FORD': ['Fiesta', 'Focus', 'Puma', 'Kuga', 'Mustang Mach-E', 'Transit', 'Ranger'],
  'BR-CHEVROLET': ['Spark', 'Cruze', 'Equinox', 'Traverse', 'Tahoe', 'Silverado 1500', 'Bolt EV'],
  'BR-JEEP': ['Wrangler', 'Cherokee', 'Grand Cherokee', 'Compass', 'Renegade', 'Gladiator'],
  'BR-TESLA': ['Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck'],
  'BR-TOYOTA': ['Yaris', 'Corolla', 'Camry', 'Prius', 'RAV4', 'C-HR', 'Hilux', 'Land Cruiser', 'bZ4X'],
  'BR-LEXUS': ['UX', 'NX', 'RX', 'IS', 'ES', 'LS', 'RZ'],
  'BR-HONDA': ['Civic', 'Accord', 'CR-V', 'HR-V', 'Jazz', 'Pilot'],
  'BR-NISSAN': ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Ariya', 'Navara'],
  'BR-MAZDA': ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'MX-5'],
  'BR-SUBARU': ['Impreza', 'Legacy', 'Outback', 'Forester', 'Crosstrek', 'WRX'],
  'BR-MITSUBISHI': ['Space Star', 'ASX', 'Eclipse Cross', 'Outlander', 'L200'],
  'BR-SUZUKI': ['Swift', 'Ignis', 'Vitara', 'S-Cross', 'Jimny', 'Baleno'],
  'BR-HYUNDAI': ['i10', 'i20', 'i30', 'Kona', 'Tucson', 'Santa Fe', 'Ioniq 5', 'Ioniq 6'],
  'BR-KIA': ['Picanto', 'Rio', 'Ceed', 'Stonic', 'Sportage', 'Sorento', 'EV6', 'EV9', 'Niro'],
  'BR-VOLVO': ['XC40', 'XC60', 'XC90', 'S60', 'S90', 'V60', 'V90', 'C40', 'EX30', 'EX90'],
  'BR-BYD': ['Atto 3', 'Dolphin', 'Seal', 'Han', 'Tang', 'Seagull'],
  'BR-MG': ['MG3', 'MG4', 'MG5', 'MG ZS', 'MG HS', 'Cyberster'],
  'BR-GEELY': ['Coolray', 'Emgrand', 'Monjaro', 'Galaxy L7'],
  'BR-CHERY': ['Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 8'],
  'BR-GREAT-WALL': ['Poer', 'Cannon', 'Haval H6', 'Tank 300']
};

const ENGINE_TEMPLATES = [
  ['Essence atmosphérique', 1000, 75, 'ESSENCE'],
  ['Essence turbocompressé', 1500, 130, 'ESSENCE'],
  ['Essence performance', 2000, 220, 'ESSENCE'],
  ['Diesel', 1600, 115, 'DIESEL'],
  ['Diesel HD', 2000, 180, 'DIESEL'],
  ['Hybride', 1800, 140, 'HYBRID'],
  ['Hybride rechargeable', 2000, 218, 'PHEV'],
  ['Électrique', 0, 150, 'ELECTRIC'],
  ['Électrique performance', 0, 300, 'ELECTRIC'],
  ['GPL', 1400, 90, 'GPL'],
  ['Mild-Hybrid', 1500, 130, 'MILD-HYBRID']
];

const DTC_RAW = [
  ['P0100', 'Circuit débitmètre d’air (MAF)', 'MAF défectueux, filtre encrassé, fuite admission', 'Nettoyer/remplacer MAF, vérifier durites', 'medium'],
  ['P0101', 'Circuit MAF plage hors limites', 'MAF sale, fuite vide, papillon encrassé', 'Nettoyer MAF, rechercher fuite', 'medium'],
  ['P0115', 'Circuit température liquide ECT', 'Capteur ECT HS, câblage', 'Remplacer ECT, vérifier liquide', 'high'],
  ['P0120', 'Circuit capteur position papillon', 'TPS HS, câblage, papillon usé', 'Remplacer TPS, réparer faisceau', 'high'],
  ['P0125', 'Température liquide insuffisante boucle fermée', 'Thermostat bloqué ouvert, ECT HS', 'Remplacer thermostat, vérifier ECT', 'medium'],
  ['P0130', 'Circuit sonde lambda B1S1', 'Sonde HS, câblage, fuite échappement', 'Remplacer sonde, réparer faisceau', 'medium'],
  ['P0171', 'Système trop pauvre banque 1', 'Fuite admission, MAF sale, injecteurs, pompe faible', 'Test fumigène, nettoyer MAF, tester pression', 'high'],
  ['P0172', 'Système trop riche banque 1', 'Injecteurs qui fuient, régulateur HS', 'Tester injecteurs, vérifier pression', 'high'],
  ['P0200', 'Circuit injecteur', 'Injecteur HS, câblage, driver ECU', 'Tester injecteur, réparer câblage', 'high'],
  ['P0300', 'Ratés d’allumage aléatoires/multiples', 'Bougies, bobines, injecteurs, fuite, compression', 'Remplacer bougies, tester bobines/injecteurs', 'critical'],
  ['P0301', 'Ratés cylindre 1', 'Bougie, bobine, injecteur ou compression cyl.1', 'Permuter composants, tester compression', 'critical'],
  ['P0335', 'Circuit capteur vilebrequin CKP', 'Capteur CKP HS, cible, câblage', 'Remplacer CKP, inspecter cible', 'critical'],
  ['P0340', 'Circuit capteur arbre à cames', 'Capteur CMP HS, câblage, distribution', 'Remplacer CMP, vérifier distribution', 'critical'],
  ['P0350', 'Circuit bobine d’allumage', 'Bobine HS, câblage, bougie', 'Remplacer bobine, tester bougies', 'high'],
  ['P0400', 'Circuit EGR', 'Vanne EGR bloquée, solénoïde, conduits', 'Nettoyer/remplacer EGR', 'medium'],
  ['P0420', 'Efficacité catalyseur sous seuil', 'Catalyseur HS, sonde, fuite', 'Tester sondes, vérifier fuites', 'high'],
  ['P0440', 'Circuit EVAP', 'Bouchon, fuite EVAP, vanne purge', 'Vérifier bouchon, test fumigène', 'low'],
  ['P0562', 'Tension système basse', 'Batterie faible, alternateur, masses', 'Tester batterie/alternateur, masses', 'high'],
  ['P0563', 'Tension système haute', 'Régulateur HS, surcharge', 'Tester régulateur/alternateur', 'high'],
  ['P0600', 'Liaison série ECU', 'ECU HS, CAN corrompu', 'Vérifier CAN, reprogrammer ECU', 'critical'],
  ['P0700', 'Circuit commande boîte', 'TCM, câblage, solénoïdes, huile BV', 'Vérifier huile BV, tester TCM', 'critical'],
  ['P0750', 'Solénoïde shift A', 'Solénoïde HS, huile BV', 'Remplacer solénoïde, vidanger BV', 'high'],
  ['P2002', 'FAP/DPF efficacité sous seuil', 'FAP colmaté, capteur différentiel', 'Régénération, nettoyer/remplacer FAP', 'high'],
  ['P20EE', 'Réduction SCR efficacité faible', 'AdBlue, pompe SCR, capteur NOx', 'Vérifier AdBlue, SCR', 'high'],
  ['P2187', 'Système trop pauvre au ralenti', 'Fuite vide, MAF, injecteurs, pompe', 'Test fumigène, nettoyer MAF', 'medium'],
  ['P0A00', 'Convertisseur DC/DC dysfonctionnement', 'DC/DC HS, fusible HT, câblage HT', 'Contrôler fusibles HT, tester DC/DC', 'critical'],
  ['P0A14', 'Résistance isolement batterie faible', 'Fuite HT, humidité, câble HS', 'Test isolement, séchage, remplacement', 'critical'],
  ['P0A16', 'Tension batterie trop basse', 'Décharge profonde, cellules faibles', 'Contrôler SOC/SOH, modules', 'critical'],
  ['P0AA6', 'Défaut isolement batterie hybride', 'Fuite HT, humidité, câble', 'Test isolement, inspection HT', 'critical'],
  ['P0C0A', 'Groupe motopropulseur électrique performance', 'Moteur électrique, onduleur, capteurs', 'Diagnostic onduleur/moteur', 'critical'],
  ['U0100', 'Perte communication ECM/PCM', 'ECU HS, CAN, alimentation', 'Vérifier alimentation/masse, CAN', 'critical'],
  ['U0121', 'Perte communication module ABS', 'ABS HS, CAN, fusible', 'Tester alimentation ABS, CAN', 'critical'],
  ['U0155', 'Perte communication BCM', 'BCM HS, CAN, humidité', 'Vérifier BCM, fusibles, CAN', 'high']
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
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

function buildReference(seedTs = now()) {
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
      app_version: '4.3.0',
      data_version: 1,
      last_data_update: ts,
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
    elm_profiles: DEFAULT_ELM_PROFILES,
    elm_logs: []
  };
}

let db = null;
let saveTimer = null;

function saveDbSync() {
  if (!db) return;
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDbSync, 300);
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

      parsed.meta = parsed.meta || {};
      parsed.security = parsed.security || seedDb().security;
      parsed.settings = parsed.settings || {};
      parsed.settings.background = parsed.settings.background || seedDb().settings.background;
      parsed.devices = parsed.devices || {};
      parsed.access_requests = parsed.access_requests || {};
      parsed.push_subscriptions = parsed.push_subscriptions || {};
      parsed.audit = Array.isArray(parsed.audit) ? parsed.audit : [];
      parsed.workshop = parsed.workshop || {};
      parsed.elm_logs = Array.isArray(parsed.elm_logs) ? parsed.elm_logs : [];

      if (!parsed.meta.jwt_secret) parsed.meta.jwt_secret = crypto.randomBytes(48).toString('hex');
      if (!parsed.meta.vapid) parsed.meta.vapid = webPush.generateVAPIDKeys();
      if (!parsed.meta.app_version) parsed.meta.app_version = '4.3.0';
      if (!parsed.meta.data_version) parsed.meta.data_version = 1;

      if (!parsed.reference || !Array.isArray(parsed.reference.brands) || !parsed.reference.brands.length) {
        parsed.reference = buildReference();
      }

      if (!parsed.elm_profiles || !Array.isArray(parsed.elm_profiles.ecu_groups)) {
        parsed.elm_profiles = DEFAULT_ELM_PROFILES;
      }

      const externalProfilesPath = path.join(__dirname, 'elm-profiles.json');
      if (fs.existsSync(externalProfilesPath)) {
        try {
          const external = JSON.parse(fs.readFileSync(externalProfilesPath, 'utf8'));
          if (external && Array.isArray(external.ecu_groups)) {
            parsed.elm_profiles = external;
          }
        } catch (err) {
          console.warn('⚠️ server/elm-profiles.json ignoré :', err.message);
        }
      }

      return parsed;
    }
  } catch (err) {
    console.error('❌ DB corrompue, reseed :', err.message);
    try {
      fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`);
    } catch {}
  }

  const seeded = seedDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2));
  return seeded;
}

db = loadDb();

process.on('exit', saveDbSync);
process.on('SIGINT', () => {
  saveDbSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveDbSync();
  process.exit(0);
});

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@diagauto.local',
  db.meta.vapid.publicKey,
  db.meta.vapid.privateKey
);

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

      if (roles && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Role not allowed' });
      }

      if (decoded.role === 'guest') {
        const device = db.devices[decoded.deviceId];
        if (!device || device.status !== 'granted') {
          return res.status(403).json({ error: 'Access revoked or not granted' });
        }
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
app.use(express.json({ limit: '200mb' }));
app.use('/media', express.static(MEDIA_DIR));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

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
      url: '/?tab=access'
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

    logAudit({
      deviceId: req.auth.deviceId,
      actor: 'owner',
      action: 'background_updated',
      details: { url: bg.url, enabled: bg.enabled }
    });

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

  logAudit({
    deviceId: request.device_id,
    actor,
    action: `access_${status}`,
    details: { requestId, requesterName: request.requester_name }
  });

  wsBroadcast({ type: 'ACCESS_UPDATED', payload: request });

  if (status === 'granted') {
    const token = signGuestToken(request.device_id, request.role || 'guest');
    wsBroadcast({ type: 'ACCESS_GRANTED', deviceId: request.device_id, token }, request.device_id);
    await notifyAccessGranted(request.device_id, token, request.requester_name)
      .catch(err => console.warn('Push guest échoué:', err.message));
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
    if (decoded.requestId !== requestId || decoded.action !== action) {
      return res.status(403).json({ error: 'Action token invalide' });
    }

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

app.get('/api/workshop/delta', auth(true), (req, res) => {
  const since = Number(req.query.since || 0);
  const records = Object.values(db.workshop || {})
    .filter(r => Number(r.updated_at || 0) > since)
    .sort((a, b) => a.updated_at - b.updated_at);

  res.json({ since, server_time: now(), records });
});

app.post('/api/workshop/push', auth(true), (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records[] requis' });

  let applied = 0;

  for (const rec of records) {
    if (!rec?.id || !['vehicle', 'intervention'].includes(rec.type)) continue;

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

  logAudit({
    deviceId: req.auth.deviceId,
    actor: req.auth.role,
    action: 'workshop_push',
    details: { applied }
  });

  res.json({ success: true, applied, server_time: now() });
});

app.get('/api/elm/profiles', (req, res) => {
  res.json(db.elm_profiles || DEFAULT_ELM_PROFILES);
});

app.post('/api/elm/profiles', requireOwner, (req, res) => {
  try {
    const profiles = req.body || {};
    if (typeof profiles !== 'object' || Array.isArray(profiles)) {
      return res.status(400).json({ error: 'Objet de profils attendu' });
    }

    if (!Array.isArray(profiles.ecu_groups)) {
      return res.status(400).json({ error: 'profils.ecu_groups[] requis' });
    }

    db.elm_profiles = {
      ...DEFAULT_ELM_PROFILES,
      ...profiles,
      updated_at: now()
    };

    saveDb();

    logAudit({
      deviceId: req.auth.deviceId,
      actor: 'owner',
      action: 'elm_profiles_updated',
      details: { version: db.elm_profiles.version, ecu_groups: db.elm_profiles.ecu_groups.length }
    });

    res.json({ success: true, profiles: db.elm_profiles });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/elm/log', auth(true), (req, res) => {
  const { action, command, response, ok, meta } = req.body || {};

  const rec = {
    id: uid(),
    ts: now(),
    deviceId: req.auth.deviceId,
    actor: req.auth.role,
    action: action || 'elm_command',
    command: String(command || '').slice(0, 1000),
    response: String(response || '').slice(0, 4000),
    ok: ok !== false,
    meta: meta || null
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

app.post('/api/import/trigger', requireOwner, (req, res) => {
  try {
    db.reference = buildReference();
    const version = bumpDataVersion();

    logAudit({
      deviceId: req.auth.deviceId,
      actor: 'owner',
      action: 'import_trigger',
      details: { version }
    });

    res.json({ success: true, version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/media')) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

server.listen(PORT, () => {
  console.log(`🚀 DiagAuto Pro 4.3.0 : http://localhost:${PORT}`);
  console.log(`🔑 Code propriétaire : ${OWNER_CODE}`);

  const requiredPublic = ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest'];
  for (const file of requiredPublic) {
    if (!fs.existsSync(path.join(PUBLIC_DIR, file))) {
      console.warn(`⚠️ Fichier public manquant : public/${file}`);
    }
  }
});
