-- HK LCSD master data seed: locations and badminton courts
-- Source: Leisure and Cultural Services Department (LCSD) sports centres
-- Facility directory: https://www.lcsd.gov.hk/en/facilities/facilitieslist/landsports/sportcentre.html
-- District lookup: https://www.lcsd.gov.hk/clpss/en/webApp/Facility/District.do?ftid=0
--
-- Requires an existing country row: name = 'Hong Kong', code = 'HK'
-- Apply with: nhost up --apply-seeds

DO $$
DECLARE
  hk_id uuid;
  loc record;
  court_count integer;
  i integer;
BEGIN
  SELECT id INTO hk_id
  FROM public.master_countries
  WHERE code = 'HK'
  LIMIT 1;

  IF hk_id IS NULL THEN
    RAISE EXCEPTION 'Country Hong Kong (code HK) must exist before applying this seed';
  END IF;

  -- (name, address, badminton_court_count per LCSD facility descriptions)
  FOR loc IN
    SELECT *
    FROM (
      VALUES
        -- Hong Kong Island
        ('Hong Kong Park Sports Centre', '29 Cotton Tree Drive, Central, Hong Kong', 8),
        ('Lockhart Road Sports Centre', '10-12/F, Lockhart Road Municipal Services Building, 225 Hennessy Road, Wan Chai', 3),
        ('Morrison Hill Sports Centre', '9 Sung Fung Road, Wan Chai', 12),
        ('Java Road Sports Centre', '52 Java Road, North Point', 8),
        ('Island East Sports Centre', '52 Lei King Road, Sai Wan Ho', 8),
        ('Aberdeen Sports Centre', '1 Aberdeen Reservoir Road, Aberdeen', 6),
        ('Ap Lei Chau Sports Centre', 'Ap Lei Chau Sports Centre, Ap Lei Chau', 6),
        ('Chai Wan Sports Centre', '2-10 New Street, Chai Wan', 8),
        -- Kowloon
        ('Kowloon Park Sports Centre', '22 Austin Road, Tsim Sha Tsui', 12),
        ('Tai Kok Tsui Sports Centre', '13 Hoi Fan Road, Tai Kok Tsui', 8),
        ('Boundary Street Sports Centre', '200 Boundary Street, Sham Shui Po', 8),
        ('Sham Shui Po Sports Centre', '2-4/F, Sham Shui Po Sports Centre, 220 Lai Chi Kok Road', 6),
        ('Ho Man Tin Sports Centre', '14 Fat Kwong Street, Ho Man Tin', 6),
        ('Kowloon Bay Sports Centre', '15 Kai Lai Road, Kowloon Bay', 8),
        ('Ngau Tau Kok Road Sports Centre', '3 Ngau Tau Kok Road, Kwun Tong', 8),
        ('Lam Tin Sports Centre', '70 Kai Tin Road, Lam Tin', 8),
        ('Choi Hung Road Sports Centre', '150 Choi Hung Road, San Po Kong', 8),
        ('Choi Hung Road Badminton Centre', '150 Choi Hung Road, San Po Kong (Badminton Centre)', 6),
        ('Po Kong Village Road Sports Centre', '120 Po Kong Village Road, Tsz Wan Shan', 8),
        ('Ngau Chi Wan Sports Centre', '20 Clear Water Bay Road, Ngau Chi Wan', 8),
        ('Ma Chai Hang Sports Centre', '30 Ma Chai Hang Road, Wong Tai Sin', 8),
        -- New Territories
        ('Tseung Kwan O Sports Centre', '9 Wan Lung Road, Tseung Kwan O', 8),
        ('Hang Hau Sports Centre', '2 Wan Hang Road, Tseung Kwan O', 8),
        ('Po Lam Sports Centre', '38 Po Hong Road, Tseung Kwan O', 8),
        ('Sai Kung Sports Centre', '30 Tai Mong Tsai Road, Sai Kung', 6),
        ('Ma On Shan Sports Centre', '14 On Chun Street, Ma On Shan', 8),
        ('Sha Tin Sports Centre', '21 Yuen Wo Road, Sha Tin', 12),
        ('Yuen Chau Kok Sports Centre', '35 Ngan Shing Street, Sha Tin', 8),
        ('Tai Po Sports Centre', '34 Tai Po Road, Tai Po', 8),
        ('Tsuen Wan Sports Centre', '52 Hoi Pa Street, Tsuen Wan', 8),
        ('Tuen Mun Recreation and Sports Centre', '3 Tuen Hi Road, Tuen Mun', 8),
        ('Tin Shui Wai Sports Centre', '1 Tin Shui Road, Tin Shui Wai', 8),
        ('Sheung Shui Sports Centre', '38 Tin Ping Road, Sheung Shui', 6),
        ('Fanling Leisure and Cultural Building', '2 Fanling Station Road, Fanling', 6)
    ) AS venues(name, address, courts)
  LOOP
    INSERT INTO public.master_locations (name, country_id, address)
    SELECT loc.name, hk_id, loc.address
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.master_locations ml
      WHERE ml.country_id = hk_id
        AND ml.name = loc.name
    );

    court_count := loc.courts;

    FOR i IN 1..court_count LOOP
      INSERT INTO public.master_courts (name, location_id)
      SELECT 'Court ' || i, ml.id
      FROM public.master_locations ml
      WHERE ml.country_id = hk_id
        AND ml.name = loc.name
        AND NOT EXISTS (
          SELECT 1
          FROM public.master_courts mc
          WHERE mc.location_id = ml.id
            AND mc.name = 'Court ' || i
        );
    END LOOP;
  END LOOP;
END $$;
