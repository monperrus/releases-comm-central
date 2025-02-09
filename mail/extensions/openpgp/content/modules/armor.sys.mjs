/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  EnigmailConstants: "chrome://openpgp/content/modules/constants.sys.mjs",
});

/**
 * Locates string in text occurring only at the beginning of a line.
 */
function indexOfArmorDelimiter(text, str, offset) {
  let currentOffset = offset;
  while (currentOffset < text.length) {
    const loc = text.indexOf(str, currentOffset);

    if (loc === -1 || loc === 0 || text.charAt(loc - 1) == "\n") {
      return loc;
    }

    currentOffset = loc + str.length;
  }
  return -1;
}

function searchBlankLine(str, then) {
  var offset = str.search(/\n\s*\r?\n/);
  if (offset === -1) {
    return "";
  }
  return then(offset);
}

function indexOfNewline(str, off, then) {
  var offset = str.indexOf("\n", off);
  if (offset === -1) {
    return "";
  }
  return then(offset);
}

export var EnigmailArmor = {
  /**
   * Locates offsets bracketing PGP armored block in text,
   * starting from given offset, and returns block type string.
   *
   * @param {string} text - ASCII armored text
   * @param {integer} offset - Offset to start looking for block
   * @param {string} indentStr -Prefix that is used for all lines (such as "> ")
   * @param {object} beginIndexObj - beginIndexObj.value will contain offset
   *   of first character of block
   * @param {object} endIndexObj - endIndexObj.value will contain offset of
   *   last character of block (newline)
   * @param {object} indentStrObj - indentStrObj.value will contain indent
   *   of 1st line
   * @returns {string} the type of block found (e.g. MESSAGE, PUBLIC KEY)
   *   If no block is found, an empty string is returned.
   */
  locateArmoredBlock(
    text,
    offset,
    indentStr,
    beginIndexObj,
    endIndexObj,
    indentStrObj
  ) {
    beginIndexObj.value = -1;
    endIndexObj.value = -1;

    var beginIndex = indexOfArmorDelimiter(
      text,
      indentStr + "-----BEGIN PGP ",
      offset
    );

    if (beginIndex == -1) {
      var blockStart = text.indexOf("-----BEGIN PGP ");
      if (blockStart >= 0) {
        var indentStart = text.search(/\n.*-----BEGIN PGP /) + 1;
        indentStrObj.value = text.substring(indentStart, blockStart);
        indentStr = indentStrObj.value;
        beginIndex = indexOfArmorDelimiter(
          text,
          indentStr + "-----BEGIN PGP ",
          offset
        );
      }
    }

    if (beginIndex == -1) {
      return "";
    }

    // Locate newline at end of armor header
    offset = text.indexOf("\n", beginIndex);

    if (offset == -1) {
      return "";
    }

    var endIndex = indexOfArmorDelimiter(
      text,
      indentStr + "-----END PGP ",
      offset
    );

    if (endIndex == -1) {
      return "";
    }

    // Locate newline at end of PGP block
    endIndex = text.indexOf("\n", endIndex);

    if (endIndex == -1) {
      // No terminating newline
      endIndex = text.length - 1;
    }

    var blockHeader = text.substr(beginIndex, offset - beginIndex + 1);

    const escapedIndentStr = indentStr.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
    var blockRegex = new RegExp(
      "^" + escapedIndentStr + "-----BEGIN PGP (.{1,30})-----\\s*\\r?\\n"
    );

    var matches = blockHeader.match(blockRegex);

    var blockType = "";
    if (matches && matches.length > 1) {
      blockType = matches[1];
    }

    if (blockType == "UNVERIFIED MESSAGE") {
      // Skip any unverified message block
      return EnigmailArmor.locateArmoredBlock(
        text,
        endIndex + 1,
        indentStr,
        beginIndexObj,
        endIndexObj,
        indentStrObj
      );
    }

    beginIndexObj.value = beginIndex;
    endIndexObj.value = endIndex;

    return blockType;
  },

  /**
   * Returns an array of ASCII Armor block positions. Ff no block was found,
   * an empty array is returned
   *
   * @param {string} text - Text containing ASCII armored block(s).
   * @returns {object[]} blocks - An array of objects.
   * @returns {integer} blocks[].begin
   * @returns {integer} blocks[].end
   * @returns {string} blocks[].indent
   * @returns {string} blocks[].blocktype
   */
  locateArmoredBlocks(text) {
    var beginObj = {};
    var endObj = {};
    var indentStrObj = {};
    var blocks = [];
    var i = 0;
    var b;

    while (
      (b = EnigmailArmor.locateArmoredBlock(
        text,
        i,
        "",
        beginObj,
        endObj,
        indentStrObj
      )) !== ""
    ) {
      blocks.push({
        begin: beginObj.value,
        end: endObj.value,
        indent: indentStrObj.value ? indentStrObj.value : "",
        blocktype: b,
      });

      i = endObj.value;
    }

    return blocks;
  },

  extractSignaturePart(signatureBlock, part) {
    return searchBlankLine(signatureBlock, function (offset) {
      return indexOfNewline(signatureBlock, offset + 1, function (offset) {
        var beginIndex = signatureBlock.indexOf(
          "-----BEGIN PGP SIGNATURE-----",
          offset + 1
        );
        if (beginIndex == -1) {
          return "";
        }

        if (part === lazy.EnigmailConstants.SIGNATURE_TEXT) {
          return signatureBlock
            .substr(offset + 1, beginIndex - offset - 1)
            .replace(/^- -/, "-")
            .replace(/\n- -/g, "\n-")
            .replace(/\r- -/g, "\r-");
        }

        return indexOfNewline(signatureBlock, beginIndex, function (offset) {
          var endIndex = signatureBlock.indexOf(
            "-----END PGP SIGNATURE-----",
            offset
          );
          if (endIndex == -1) {
            return "";
          }

          var signBlock = signatureBlock.substr(offset, endIndex - offset);

          return searchBlankLine(signBlock, function (armorIndex) {
            if (part == lazy.EnigmailConstants.SIGNATURE_HEADERS) {
              return signBlock.substr(1, armorIndex);
            }

            return indexOfNewline(
              signBlock,
              armorIndex + 1,
              function (armorIndex) {
                if (part == lazy.EnigmailConstants.SIGNATURE_ARMOR) {
                  return signBlock
                    .substr(armorIndex, endIndex - armorIndex)
                    .replace(/\s*/g, "");
                }
                return "";
              }
            );
          });
        });
      });
    });
  },

  /**
   * Remove all headers from an OpenPGP Armored message and replace them
   * with a set of new headers.
   *
   * @param {string} armorText - ASCII armored message
   * @param {object} headers - A key/value pairs of new headers to insert.
   * @returns {string} a new armored message.
   */
  replaceArmorHeaders(armorText, headers) {
    const text = armorText.replace(/\r\n/g, "\n");
    let i = text.search(/\n/);
    if (i < 0) {
      return armorText;
    }
    let m = text.substr(0, i + 1);

    for (const j in headers) {
      m += j + ": " + headers[j] + "\n";
    }

    i = text.search(/\n\n/);
    if (i < 0) {
      return armorText;
    }
    m += text.substr(i + 1);

    return m;
  },

  /**
   * Get a list of all headers found in an armor message
   *
   * @param {string} text - ASCII armored message.
   * @returns {object} an object that has key/value pairs of new headers to insert.
   *   All keys are lowercase.
   */
  getArmorHeaders(text) {
    const headers = {};
    const b = this.locateArmoredBlocks(text);

    if (b.length === 0) {
      return headers;
    }

    const msg = text.substr(b[0].begin);

    // Escape regex chars.
    const indent = b[0].indent.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
    const lx = new RegExp("\\n" + indent + "\\r?\\n");
    const hdrEnd = msg.search(lx);
    if (hdrEnd < 0) {
      return headers;
    }

    const lines = msg.substr(0, hdrEnd).split(/\r?\n/);

    const rx = new RegExp("^" + b[0].indent + "([^: ]+)(: )(.*)");
    // skip 1st line (ARMOR-line)
    for (let i = 1; i < lines.length; i++) {
      const m = lines[i].match(rx);
      if (m && m.length >= 4) {
        headers[m[1].toLowerCase()] = m[3];
      }
    }

    return headers;
  },

  /**
   * Split armored blocks into an array of strings.
   *
   * @param {string} keyBlockStr
   * @returns {string[]} the key blocks.
   */
  splitArmoredBlocks(keyBlockStr) {
    const myRe = /-----BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK-----/g;
    let myArray;
    const retArr = [];
    let startIndex = -1;
    while ((myArray = myRe.exec(keyBlockStr)) !== null) {
      if (startIndex >= 0) {
        const s = keyBlockStr.substring(startIndex, myArray.index);
        retArr.push(s);
      }
      startIndex = myArray.index;
    }

    retArr.push(keyBlockStr.substring(startIndex));
    return retArr;
  },
};
