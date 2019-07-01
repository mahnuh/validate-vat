const r2 = require('r2');

const serviceUrl = 'https://ec.europa.eu/taxation_customs/vies/services/checkVatService';

const soapBodyTemplate = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"\n  xmlns:tns1="urn:ec.europa.eu:taxud:vies:services:checkVat:types"\n  xmlns:impl="urn:ec.europa.eu:taxud:vies:services:checkVat">\n  <soap:Header>\n  </soap:Header>\n  <soap:Body>\n    <tns1:checkVat xmlns:tns1="urn:ec.europa.eu:taxud:vies:services:checkVat:types"\n     xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">\n     <tns1:countryCode>%COUNTRY_CODE%</tns1:countryCode>\n     <tns1:vatNumber>%VAT_NUMBER%</tns1:vatNumber>\n    </tns1:checkVat>\n  </soap:Body>\n</soap:Envelope>';

const EU_COUNTRIES_CODES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB'];

const ERROR_MSG = {
  'INVALID_INPUT_COUNTRY': 'The country code in the VAT ID is invalid',
  'INVALID_INPUT_NUMBER': 'The VAT number part is empty or invalid',
  'SERVICE_UNAVAILABLE': 'The VIES VAT service is unavailable, please try again later',
  'MS_UNAVAILABLE': 'The VAT database of the requested member country is unavailable, please try again later',
  'MS_MAX_CONCURRENT_REQ': 'The VAT database of the requested member country has had too many requests, please try again later',
  'TIMEOUT': 'The request to VAT database of the requested member country has timed out, please try again later',
  'SERVER_BUSY': 'The service cannot process your request, please try again later',
  'UNKNOWN': 'Unknown error'
};

var headers = {
  'Content-Type': 'application/xml',
  'Accept': 'application/xml,text/xml',
  'Accept-Encoding': 'none',
  'Accept-Charset': 'utf-8',
  'Connection': 'close',
  'SOAPAction': 'urn:ec.europa.eu:taxud:vies:services:checkVat/checkVat',
  'User-Agent': 'soap node',
};

function getReadableErrorMsg(faultstring) {
  if (ERROR_MSG[faultstring]) {
    return ERROR_MSG[faultstring];
  } else {
    return ERROR_MSG['UNKNOWN'];
  }
};

function parseSoapResponse(soapMessage) {
  function parseField(field) {
    var regex = new RegExp("<" + field + ">\((\.|\\s)\*?\)</" + field + ">", 'gm');
    var match = regex.exec(soapMessage);
    if (!match) {
      let ex = new Error("Failed to parse field " + field);
      ex.soapMessage = soapMessage;
      throw ex;
    }
    return match[1].trim();
  };

  var hasFault = soapMessage.match(/<soap:Fault>\S+<\/soap:Fault>/g);
  if (hasFault) {
    let msg = getReadableErrorMsg(parseField('faultstring'));
    let ex = new Error(msg);
    ex.code = parseField('faultcode');
    throw ex;
  }
  return {
    countryCode: parseField('countryCode'),
    vatNumber: parseField('vatNumber'),
    valid: parseField('valid') === 'true',
    serverValidated: true,
    name: parseField('name'),
    address: parseField('address').replace(/\n/g, ', '),
  };
};

var vatIDRegexp = /^[A-Z]{2,2}[0-9A-Z]{2,13}$/;

/**
 * @param vatID {string} VAT ID, starting with 2-letter country code, then the number,
 *     e.g. "DE1234567890"
 * @param timeout {integer}   in ms
 * @returns {
 *   valid {boolean}   the VAT ID is OK
 *   serverValidated {boolean}   the ID was checked against the state server
 *   name {string},
 *   address {string},
 * }
 */
async function validateVAT(vatID, timeout) {
  var countryCode = vatID.substr(0, 2);
  var vatNumber = vatID.substr(2);
  if (EU_COUNTRIES_CODES.indexOf(countryCode) < 0) {
    //console.error("Country code " + countryCode + " is invalid");
    throw new Error(ERROR_MSG['INVALID_INPUT_COUNTRY']);
  }
  if (!vatIDRegexp.test(vatID)) {
    throw new Error(ERROR_MSG['INVALID_INPUT_NUMBER']);
  }
  var xml = soapBodyTemplate
      .replace('%COUNTRY_CODE%', countryCode)
      .replace('%VAT_NUMBER%', vatNumber)
      .replace('\n', '').trim();
  //headers['Content-Length'] = Buffer.byteLength(xml, 'utf8');
  var options = {
    body: xml,
    method: 'POST',
    headers: headers,
    // TODO family: 4,
    // TODO timeout
  };

  var str = await r2(serviceUrl, options).text;
  try {
    return parseSoapResponse(str);
  } catch (ex) {
    if (ex.code == "soap:Server") { // Source data server is down
      // Avoid to block our customers just because the state can't keep its servers up
      // Presume valid
      return {
        countryCode,
        vatNumber,
        valid: true,
        serverValidated: false,
        name: '',
        address: '',
      };
    }
    throw ex;
  }
};

var exports;
module.exports = exports = validateVAT;
