var util = {

  map: function (sub, func) { return [].map.apply(sub, [func]) },
  concatMap: function (sub, func) { return [].concat.apply([], util.map(sub, func)); },
  id: function (x) { return x; },
  isHighSurrogate: function (c) {
    var codeUnit = (c.charCodeAt != undefined) ? c.charCodeAt(0) : c;
    return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
  },
  numberToHexString: function(number) {
    var number = number.toString(16);
    if(number.length == 1) { number = "0" + number; }
    return "0x" + number;
  },

  /**
    take a string and return a list of the unicode characters
    */
  unicodeCharacters: function (string) {
    var chars = util.map(string, util.id);
    var result = [];
    while (chars.length > 0) {
      if (util.isHighSurrogate(chars[0])) {
        result.push(chars.shift() + chars.shift())
      } else {
        result.push(chars.shift());
      }
    }
    return result;
  },
  /**
    take a string and return a list of the unicode codepoints
    */
  unicodeCodePoints: function (string) {
    var charCodes = util.map(string, function (x) { return x.charCodeAt(0); });
    var result = [];
    while (charCodes.length > 0) {
      if (util.isHighSurrogate(charCodes[0])) {
        var high = charCodes.shift();
        var low = charCodes.shift();
        result.push(((high - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000)
      } else {
        result.push(charCodes.shift());
      }
    }
    return result;
  },
  /**
    Encode a single (unicode) character into UTF16 "bytes"
    A single unicode character may be 2 javascript characters
    */
  encodeCharUtf16: function (char) {
    return util.concatMap(char, function (c) {
      return [((0xff00 & c.charCodeAt(0)) >> 8), 0x00ff & c.charCodeAt(0)];
    });
  },
  /**
    Encode a single character into GSM0338 "bytes"
    */
  encodeCharGsm: function (char) {
    return unicodeToGsm[char.charCodeAt(0)];
  },

  _encodeEachWith: function (doEncode) {
    return function (s) {
      return util.map(util.unicodeCharacters(s), doEncode);
    }
  },
  pickencoding: function (s) {
    // choose gsm if possible otherwise ucs2
    if(util.unicodeCodePoints(s).every(function (x) {return x in unicodeToGsm})) {
      return "gsm";
    } else {
      return "ucs2";
    }
  },

  _segmentWith: function (maxSingleSegmentSize, maxConcatSegmentSize, doEncode) {
    return function (listOfUnichrs) {
      var bytes = util.map(listOfUnichrs, doEncode);

      if (listOfUnichrs.length == 0) {
        return [];
      } else if ([].concat.apply([], bytes).length <= maxSingleSegmentSize) {
        return [{text:listOfUnichrs, bytes: bytes}];
      }

      var segments = []
      while(listOfUnichrs.length > 0) {
        var segment = {text: [], bytes: []};
        var length = 0;
        function nextChrLen() {
          return bytes[0] === undefined ? length : length + bytes[0].length;
        }
        while(listOfUnichrs.length > 0 && nextChrLen() <= maxConcatSegmentSize) {
          var c = listOfUnichrs.shift()
          var b = bytes.shift();
          segment.text.push(c);
          segment.bytes.push(b);
          if(b != undefined) length += b.length;
        }
        segments.push(segment);
      }
      return segments;
    }
  }
}

var encoder = {
  gsm: util._encodeEachWith(util.encodeCharGsm),
  ucs2: util._encodeEachWith(util.encodeCharUtf16),
  auto: function (s) { return encoder[util.pickencoding(s)](s); },
}

var segmenter = {
  gsm: util._segmentWith(160, 153, util.encodeCharGsm),
  ucs2: util._segmentWith(140, 134, util.encodeCharUtf16),
  auto: function (s) { return segmenter[util.pickencoding(s)](s); },
}

var app = angular.module("smsSplitApp", []);

app.filter('hex_byte', function () {
  return function(number) {
    return util.numberToHexString(number);
  }
});

function SmsSplitCtrl($scope, $http) {

  $scope.allEncodings = ["auto", "gsm", "ucs2"];
  $scope.input = $scope.input || "";
  $scope.encoding = $scope.encoding || "gsm";

  document.getElementsByTagName("textarea")[0].focus();

  $scope.$watchCollection('[input, encoding]', function (values) {
    var input = values[0], encoding = values[1];
    $scope.inputCharacters = util.unicodeCharacters(input);
    var encodedChars = encoder[encoding](input);
    $scope.smsSegments = segmenter[$scope.encoding](angular.copy($scope.inputCharacters));
    $scope.isEncoded = util.map($scope.smsSegments, function (segment) {
      return util.map(segment.bytes, function(c) {
        return c === undefined ? "not-encoded" : ""
      })
    });
  }, true);

  $scope.highlightBytes = function (seg, charIndex) {
    var bytes = document.getElementsByClassName("p-" + seg + "-" + charIndex);
    angular.element(bytes).addClass("highlighted-bytes");
    var cp = util.unicodeCodePoints($scope.input)[charIndex].toString(16);
    var url = "http://unicode.chadrs.me/characters/unicode/U+" + cp + ".json"
    $http({
      method: "GET",
      url: url,
      headers: {Accept: "application/json"},
      cache: true
    }).success(function (data) {
      $scope.charData = data;
    });
  };

  $scope.unhighlightBytes = function (seg, charIndex) {
    var bytes = document.getElementsByClassName("p-" + seg + "-" + charIndex);
    angular.element(bytes).removeClass("highlighted-bytes");
  };

}
