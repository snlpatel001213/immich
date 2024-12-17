import { dump as dumpYaml } from 'js-yaml';
import { ComposeSpecification, PropertiesServices } from './types';

const RELEASE_VERSION = 'v1.122.0';

type Options = BaseOptions & DatabaseOptions & FolderOptions;

type BaseOptions = {
  releaseVersion: string;
  healthchecks: boolean;
};

type FolderOptions = {
  baseLocation: string;
  encodedVideoLocation?: string;
  libraryLocation?: string;
  uploadLocation?: string;
  profileLocation?: string;
  thumbnailsLocation?: string;
  backupsLocation?: string;
};

type DatabaseOptions =
  | {
      externalDatabaseUrl: string;
      databaseVectorExtension?: VectorExtension;
    }
  | {
      databaseUser: string;
      databasePassword: string;
      databaseName: string;
      databaseLocation: string;
    };

type VectorExtension = 'pgvector' | 'pgvecto.rs';

type HardwareAccelerationPlatform = 'nvenc' | 'quicksync' | 'rkmpp' | 'vappi' | 'vaapi-wsl';

const getDatabaseUri = (options: Options): { url: string; extension?: VectorExtension } => {
  if ('externalDatabaseUrl' in options) {
    return {
      url: options.externalDatabaseUrl,
      extension: options.databaseVectorExtension,
    };
  }

  const { databaseUser, databasePassword, databaseName } = options;
  return {
    url: `postgres://${databaseUser}:${databasePassword}@database:5432/${databaseName}`,
  };
};

const makeHealthcheck = (enabled: boolean, healthcheck?: string) => {
  if (!enabled) {
    return { disabled: true };
  }

  if (healthcheck) {
    return { test: healthcheck };
  }

  return;
};

const build = (options: Options): ComposeSpecification => {
  const {
    healthchecks,
    baseLocation,
    encodedVideoLocation,
    uploadLocation,
    backupsLocation,
    profileLocation,
    libraryLocation,
    thumbnailsLocation,
  } = options;

  const database = getDatabaseUri(options);

  const serverDependsOn = ['redis'];

  const internalBaseLocation = '/usr/src/app/upload';
  const serverVolumes = [
    `${baseLocation}:${internalBaseLocation}`,
    encodedVideoLocation && `${encodedVideoLocation}:${internalBaseLocation}/encoded-video`,
    libraryLocation && `${libraryLocation}:${internalBaseLocation}/library`,
    uploadLocation && `${uploadLocation}:${internalBaseLocation}/upload`,
    profileLocation && `${profileLocation}:${internalBaseLocation}/profile`,
    thumbnailsLocation && `${thumbnailsLocation}:${internalBaseLocation}/thumbs`,
    backupsLocation && `${backupsLocation}:${internalBaseLocation}/backups`,
    `/etc/localtime:/etc/localtime:ro`,
  ].filter((value): value is string => !!value);

  const spec: ComposeSpecification = {
    name: 'immich',
    services: {
      'immich-server': {
        image: `ghcr.io/immich-app/immich-server:${RELEASE_VERSION}`,
        environment: {
          DB_URL: database.url,
          DB_VECTOR_EXTENSION: database.extension,
        },
        volumes: serverVolumes,
        ports: ['2283:2283'],
        depends_on: serverDependsOn,
        restart: 'always',
        healthcheck: makeHealthcheck(healthchecks),
      },

      'immich-machine-learning': {
        image: `ghcr.io/immich-app/immich-machine-learning:${RELEASE_VERSION}-cuda`,
        volumes: ['model-cache:/cache'],
        restart: 'always',
        healthcheck: makeHealthcheck(healthchecks),
      },

      redis: {
        image: 'docker.io/redis:6.2-alpine',
        restart: 'always',
        healthcheck: makeHealthcheck(healthchecks, 'redis-cli ping || exit 1'),
      },
    },
    volumes: {
      'model-cache': {},
    },
  };

  if ('externalDatabaseUrl' in options === false) {
    const { databaseUser, databasePassword, databaseName, databaseLocation } = options;
    (spec.services as PropertiesServices).database = {
      image: 'docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0',
      restart: 'always',
      environment: {
        POSTGRES_PASSWORD: databasePassword,
        POSTGRES_USER: databaseUser,
        POSTGRES_DB: databaseName,
        POSTGRES_INITDB_ARGS: '--data-checksums',
      },
      volumes: [`${databaseLocation}:/var/lib/postgresql/data`],
      healthcheck: makeHealthcheck(
        healthchecks,
        [
          'pg_isready --dbname="$${POSTGRES_DB}" --username="$${POSTGRES_USER}" || exit 1;',
          `Chksum="$$(psql --dbname="$\${POSTGRES_DB}" --username="$\${POSTGRES_USER}" --tuples-only --no-align`,
          `--command='SELECT COALESCE(SUM(checksum_failures), 0) FROM pg_stat_database')";`,
          'echo "checksum failure count is $$Chksum";',
          `[ "$$Chksum" = '0' ] || exit 1\n`,
        ].join(' '),
      ),
      command: [
        `postgres`,
        `-c shared_preload_libraries=vectors.so`,
        `-c 'search_path="$$user", public, vectors'`,
        `-c logging_collector=on`,
        `-c max_wal_size=2GB`,
        `-c shared_buffers=512MB`,
        `-c wal_compression=on`,
      ].join(' '),
    };

    serverDependsOn.push('database');
  }

  return spec;
};

const withNewLines = (yaml: string) =>
  yaml.replaceAll(/(?<leading>[^:]\n)(?<key>[ ]{0,2}\S+:)$/gm, '$<leading>\n$<key>');

const main = () => {
  const commonOptions = {
    baseLocation: '/home/immich',
    releaseVersion: 'v1.122.0',
    healthchecks: true,
    // hardwareAcceleration: 'nvenc',
  };

  const defaultOptions: Options = {
    ...commonOptions,
    databaseName: 'immich',
    databaseUser: 'postgres',
    databasePassword: 'postgres',
    databaseLocation: '/home/immich/database',
  };

  const splitStorageOptions: Options = {
    ...defaultOptions,
    thumbnailsLocation: '/home/fast/thumbs',
  };

  const externalOptions: Options = {
    ...commonOptions,
    externalDatabaseUrl: 'postgres://immich:immich@localhost:5432/immich',
    databaseVectorExtension: 'pgvector',
  };

  const spec = build(externalOptions);

  const yaml = dumpYaml(spec, { indent: 2, lineWidth: 140 });
  let output = withNewLines(yaml);

  console.log(output);
};

main();

// get.immich.app/install?hardware-acceleration=nvenc&api-port=2283&vector-extension=pgvector&data=/data&thumbs=/thumbs&release-version=1.122.0&database-user=admin&database-password=admin&database-name=immich&no-healthchecks
