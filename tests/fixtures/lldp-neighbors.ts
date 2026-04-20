/**
 * Representative `show lldp neighbors` output fixtures.
 * Used by tests to exercise the LLDP parser without a live serial connection.
 */

/** Typical EX output with a single upstream neighbor. */
export const LLDP_SINGLE_NEIGHBOR = `\
Local Interface    Parent Interface  Chassis Id         Port info          System Name
ge-0/0/0.0         -                 44:f4:77:12:34:56  ge-0/1/5           core-sw-01
`;

/** Two neighbors — one on the uplink port, one on a downstream port. */
export const LLDP_TWO_NEIGHBORS = `\
Local Interface    Parent Interface  Chassis Id         Port info          System Name
ge-0/0/0.0         -                 44:f4:77:12:34:56  ge-0/1/5           core-sw-01
ge-0/0/1.0         -                 a8:d0:e5:aa:bb:cc  ge-0/2/3           ap-floor-2
`;

/** Neighbor where the port info contains a Mist alias with spaces. */
export const LLDP_MIST_ALIAS_PORT = `\
Local Interface    Parent Interface  Chassis Id         Port info          System Name
xe-0/0/0.0         -                 2c:21:72:ab:cd:ef  Trunk_uplink       dist-sw-02
`;

/** No neighbors — empty table (just the header). */
export const LLDP_EMPTY = `\
Local Interface    Parent Interface  Chassis Id         Port info          System Name
`;

/** No header line — fallback parsing path. */
export const LLDP_NO_HEADER = `\
ge-0/0/0.0         -                 44:f4:77:12:34:56  ge-0/1/5           core-sw-01
`;
