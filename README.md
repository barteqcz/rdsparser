# rdsparser

**JavaScript RDS/RBDS group decoder** with progressive error-weighted text correction. Ported from [Konrad Kosmatka's librdsparser](https://github.com/kkonradpl/librdsparser). 

## Install

```sh
npm install @barteqcz/rdsparser
```

## Decoder features

- PI, PTY, TP, TA, M/S, RDS/RBDS PTY lookup
- PS, RadioText 2A/2B, PTYN, Long PS (LPS)
- Alternative Frequencies (AF), ECC/country detection, Clock Time (CT)
- Progressive per-character error-quality correction for PS and RT
- Adaptive static/dynamic PS detection, configurable thresholds
- Optional extended checking for scalar fields and AF
- Independent parser instances (one per receiver)

## License and attribution

**LGPL-2.1-or-later.** Ported from **librdsparser** by Konrad Kosmatka, Copyright © 2023–2025. See [LICENSE](LICENSE) for the license terms. `rdsparser` is an independent port, not an official release from the original author.
