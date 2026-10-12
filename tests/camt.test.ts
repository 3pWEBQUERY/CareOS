import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankCredits } from "@/lib/camt";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>MSG1</MsgId><CreDtTm>2026-10-05T08:00:00</CreDtTm></GrpHdr>
    <Ntfctn>
      <Id>N1</Id>
      <Ntry>
        <Amt Ccy="CHF">3460.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-10-03</Dt></BookgDt>
        <ValDt><Dt>2026-10-03</Dt></ValDt>
        <AcctSvcrRef>ENTRY-1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>TX-1</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">3360.00</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <RltdPties><Dbtr><Pty><Nm>Claudia Müller</Nm></Pty></Dbtr></RltdPties>
            <RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp>
              <Ref>000000000000000000000000016</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>TX-2</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">100.5</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <RltdPties><Dbtr><Nm>Hans Beispiel</Nm></Dbtr></RltdPties>
            <RmtInf><Strd><CdtrRefInf><Ref>RF78 000123</Ref></CdtrRefInf></Strd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-10-03</Dt></BookgDt>
        <AcctSvcrRef>ENTRY-2</AcctSvcrRef>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">20.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <RvslInd>true</RvslInd>
        <BookgDt><Dt>2026-10-04</Dt></BookgDt>
        <AcctSvcrRef>ENTRY-3</AcctSvcrRef>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">75.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-10-04</Dt></BookgDt>
        <AcctSvcrRef>ENTRY-4</AcctSvcrRef>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`;

test("Bankdatei camt.054: nur Gutschriften mit Betrag, Datum, Referenz und Bankreferenz", () => {
  assert.deepEqual(parseBankCredits(SAMPLE), [
    {
      bankReference: "TX-1",
      bookedOn: "2026-10-03",
      amountCents: 336000,
      currency: "CHF",
      reference: "000000000000000000000000016",
      debtor: "Claudia Müller",
    },
    {
      bankReference: "TX-2",
      bookedOn: "2026-10-03",
      amountCents: 10050,
      currency: "CHF",
      reference: "RF78000123",
      debtor: "Hans Beispiel",
    },
    // Ohne Einzelheiten: der ganze Eintrag, ohne Zahlungsreferenz.
    { bankReference: "ENTRY-4", bookedOn: "2026-10-04", amountCents: 7500, currency: "CHF", reference: "", debtor: "" },
  ]);
});

test("Bankdatei: Kontoauszug camt.053 und ungültige Dateien", () => {
  const statement = SAMPLE.replace(/BkToCstmrDbtCdtNtfctn/g, "BkToCstmrStmt").replace(/Ntfctn>/g, "Stmt>");
  assert.equal(parseBankCredits(statement).length, 3);
  assert.throws(() => parseBankCredits("<Document><Andere/></Document>"), /camt\.054 oder camt\.053/);
  assert.throws(() => parseBankCredits("kein xml <<"), /Bankdatei|XML/);
  assert.throws(
    () => parseBankCredits(`<!DOCTYPE x [<!ENTITY a "aaaa">]>${SAMPLE.replace(/<\?xml[^>]*>/, "")}`),
    /DOCTYPE/,
  );
});
