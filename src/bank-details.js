// RIB Maison Smalto — commun à b2b-smalto (paiement par virement au checkout
// revendeur) et b2c-smalto (paiement par virement au checkout client + email
// de confirmation de commande). Données publiques d'instruction de paiement,
// pas un secret — importable aussi bien côté serveur (api/) que client (React).
export const BANK_DETAILS = {
  accountHolder: "FRANCESCO SMALTO GROUP",
  address: "10 Avenue d'Eylau, 75016 Paris, France",
  bankName: "BRED PARIS KLEBER",
  iban: "FR76 1010 7001 3000 1270 5851 177",
  bic: "BREDFRPPXXX",
  codeBanque: "10107",
  codeGuichet: "00130",
  numeroCompte: "00127058511",
  cle: "77",
};
